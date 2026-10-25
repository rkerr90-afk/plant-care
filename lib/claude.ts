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

// ---------- Health check ----------

export type Diagnosis = {
  photo_usable: boolean;
  retake_hint: string;
  healthy: boolean;
  issue: string;
  category: 'pests' | 'disease' | 'watering' | 'light' | 'nutrition' | 'environment' | 'other';
  confidence: 'high' | 'medium' | 'low';
  signs: string;
  explanation: string;
  do_now: string[];
  repeat_action: string;
  repeat_every_days: number;
  check_in_days: number;
  also_could_be: string;
  watering_change: 'none' | 'water_less' | 'water_more';
  check_nearby: boolean;
};

export type ProgressReview = {
  advice: string;
  next_steps: string[];
  escalate: boolean;
  check_in_days: number;
};

const HEALTH_SYSTEM =
  'You are an experienced, practical plant doctor for a UK plant-care app used on a phone. ' +
  'Diagnose from what is actually visible, using the plant context to weigh causes: overwatering is the most ' +
  'common cause of houseplant decline, and dry centrally heated air in winter favours spider mites. ' +
  'Prefer gentle, widely available UK treatments first (rinsing, wiping, insecticidal soap, neem oil, ' +
  'repotting, moving the plant) and escalate only when needed. If the household has pets, only suggest ' +
  'treatments that are safe around dogs and cats, and say so. Write short, plain sentences. Never use dashes ' +
  'as punctuation.';

function img(b64: string): Anthropic.ImageBlockParam {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } };
}

export async function diagnosePlant(photoBase64: string, context: string, note: string): Promise<Diagnosis> {
  return structured<Diagnosis>({
    system: HEALTH_SYSTEM,
    content: [
      img(photoBase64),
      {
        type: 'text',
        text:
          `${context}\n\n` +
          (note.trim() ? `The owner says: "${note.trim()}"\n\n` : '') +
          'What is wrong with this plant, if anything, and what should they do?',
      },
    ],
    tool: {
      name: 'report_diagnosis',
      description: 'Report the health check.',
      input_schema: {
        type: 'object',
        required: [
          'photo_usable', 'retake_hint', 'healthy', 'issue', 'category', 'confidence', 'signs', 'explanation',
          'do_now', 'repeat_action', 'repeat_every_days', 'check_in_days', 'also_could_be', 'watering_change', 'check_nearby',
        ],
        properties: {
          photo_usable: { type: 'boolean', description: 'False if too blurry, dark or far away to judge' },
          retake_hint: { type: 'string', description: 'If not usable: what photo to take instead. Else empty.' },
          healthy: { type: 'boolean', description: 'True if nothing meaningful is wrong' },
          issue: { type: 'string', description: 'Short name of the most likely problem, e.g. "Spider mites". Empty if healthy.' },
          category: { type: 'string', enum: ['pests', 'disease', 'watering', 'light', 'nutrition', 'environment', 'other'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          signs: { type: 'string', description: 'One sentence: what you can see in the photo' },
          explanation: { type: 'string', description: 'One or two sentences on the likely cause, for this plant and setting' },
          do_now: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Ordered, concrete steps for today' },
          repeat_action: { type: 'string', description: 'Treatment to repeat, e.g. "Wipe leaves with insecticidal soap". Empty if none.' },
          repeat_every_days: { type: 'integer', minimum: 0, maximum: 30, description: '0 if nothing to repeat' },
          check_in_days: { type: 'integer', minimum: 2, maximum: 21, description: 'Days until it is worth checking progress' },
          also_could_be: { type: 'string', description: 'The main alternative and how to tell. Empty if none.' },
          watering_change: { type: 'string', enum: ['none', 'water_less', 'water_more'], description: 'Only if watering is a cause' },
          check_nearby: { type: 'boolean', description: 'True for problems that spread to other plants' },
        },
      },
    },
  });
}

export async function reviewProgress(opts: {
  context: string;
  issue: string;
  plan: string;
  history: string;
  outcome: 'same' | 'worse';
  daysOpen: number;
  note: string;
  firstPhoto: string | null;
  newPhoto: string | null;
}): Promise<ProgressReview> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (opts.firstPhoto) content.push({ type: 'text', text: 'Photo when the problem was found:' }, img(opts.firstPhoto));
  if (opts.newPhoto) content.push({ type: 'text', text: 'Photo today:' }, img(opts.newPhoto));
  content.push({
    type: 'text',
    text:
      `${opts.context}\n\nProblem: ${opts.issue} (found ${opts.daysOpen} days ago).\nPlan so far: ${opts.plan}\n` +
      `Check-ins so far: ${opts.history || 'none'}\n` +
      `Today the owner says it is ${opts.outcome === 'worse' ? 'WORSE' : 'the SAME'}.` +
      (opts.note.trim() ? ` They add: "${opts.note.trim()}"` : '') +
      (opts.daysOpen >= 28 ? '\nIt has been four weeks or more: consider firmer measures, or say honestly if the plant may not recover.' : '') +
      '\n\nWhat should they do next?',
  });
  return structured<ProgressReview>({
    system: HEALTH_SYSTEM,
    content,
    tool: {
      name: 'report_progress',
      description: 'Advice for the next stage of treatment.',
      input_schema: {
        type: 'object',
        required: ['advice', 'next_steps', 'escalate', 'check_in_days'],
        properties: {
          advice: { type: 'string', description: 'Two or three sentences: what the comparison shows and the plan now' },
          next_steps: { type: 'array', maxItems: 4, items: { type: 'string' } },
          escalate: { type: 'boolean', description: 'True if moving to a stronger treatment' },
          check_in_days: { type: 'integer', minimum: 1, maximum: 14 },
        },
      },
    },
  });
}
