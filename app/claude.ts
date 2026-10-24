import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { CareProfile } from './care';
import { env } from './supabase';

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') });
  return client;
}
const model = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

export type Candidate = {
  common_name: string;
  scientific_name: string;
  confidence: 'high' | 'medium' | 'low';
  why: string;
};

export type Identification = { is_plant: boolean; candidates: Candidate[] };

/**
 * Calls Claude with a single tool so the answer comes back as structured JSON. Some models reject a
 * forced tool_choice, so we leave it on auto and instruct the model to call the tool instead.
 */
async function structured<T>(opts: {
  system: string;
  content: Anthropic.MessageParam['content'];
  tool: { name: string; description: string; input_schema: Anthropic.Tool['input_schema'] };
  maxTokens?: number;
}): Promise<T> {
  const res = await anthropic().messages.create({
    model: model(),
    max_tokens: opts.maxTokens ?? 4096,
    system: `${opts.system}\n\nRespond only by calling the ${opts.tool.name} tool. Do not write any other text.`,
    tools: [opts.tool],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: opts.content }],
  });
  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('Claude returned no structured answer');
  return block.input as T;
}

export async function identifyPlant(jpegBase64: string): Promise<Identification> {
  return structured<Identification>({
    system:
      'You identify houseplants and garden container plants from photos for a UK plant-care app. ' +
      'Give up to three candidate species, most likely first. Use accepted scientific names. ' +
      'If the photo does not show a plant, set is_plant to false and return no candidates.',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
      { type: 'text', text: 'Identify this plant.' },
    ],
    tool: {
      name: 'report_identification',
      description: 'Report the plant identification.',
      input_schema: {
        type: 'object',
        required: ['is_plant', 'candidates'],
        properties: {
          is_plant: { type: 'boolean' },
          candidates: {
            type: 'array',
            maxItems: 3,
            items: {
              type: 'object',
              required: ['common_name', 'scientific_name', 'confidence', 'why'],
              properties: {
                common_name: { type: 'string', description: 'Common UK name' },
                scientific_name: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                why: { type: 'string', description: 'One short sentence: the visible features that point to it' },
              },
            },
          },
        },
      },
    },
  });
}

export async function careProfileFor(scientificName: string, commonName: string): Promise<CareProfile> {
  return structured<CareProfile>({
    system:
      'You are a horticulturist writing care profiles for a UK plant-care app (temperate climate, ' +
      'central-heated homes). Be practical and conservative: overwatering kills more houseplants than ' +
      'underwatering. The base interval assumes active growth, a plastic pot of average size with drainage, ' +
      'and medium indirect light; the app adjusts it for light, pot, heating and season.',
    content: [{ type: 'text', text: `Care profile for ${commonName} (${scientificName}).` }],
    tool: {
      name: 'care_profile',
      description: 'Return the care profile.',
      input_schema: {
        type: 'object',
        required: [
          'common_name', 'scientific_name', 'base_interval_days', 'dormant_months', 'dormancy_multiplier',
          'water_amount', 'water_method', 'watering_instructions', 'soil_check', 'light_preference',
          'toxic_to_pets', 'toxicity_note', 'min_temp_c', 'feeding', 'care_summary',
        ],
        properties: {
          common_name: { type: 'string' },
          scientific_name: { type: 'string' },
          base_interval_days: { type: 'integer', minimum: 1, maximum: 45 },
          dormant_months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 } },
          dormancy_multiplier: { type: 'number', minimum: 1, maximum: 4 },
          water_amount: { type: 'string', enum: ['soak', 'moderate', 'small'] },
          water_method: { type: 'string', enum: ['top', 'bottom', 'either'] },
          watering_instructions: { type: 'string', description: 'One short imperative line, e.g. "Soak, then let it drain fully"' },
          soil_check: { type: 'string', description: 'How to tell it needs water, one line' },
          light_preference: { type: 'string' },
          toxic_to_pets: { type: 'boolean', description: 'True if toxic to dogs or cats' },
          toxicity_note: { type: 'string', description: 'One line, empty if not toxic' },
          min_temp_c: { type: 'number' },
          feeding: {
            type: 'object',
            required: ['months', 'every_weeks'],
            properties: {
              months: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 12 } },
              every_weeks: { type: 'integer', minimum: 0, maximum: 12 },
            },
          },
          care_summary: { type: 'string', description: 'Two or three sentences of the most useful care advice' },
        },
      },
    },
  });
}
