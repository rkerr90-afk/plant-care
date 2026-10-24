'use client';

import type { PlantContext } from '@/lib/care';

export type ContextState = {
  setting: 'indoor' | 'outdoor';
  spot: string;
  light: PlantContext['light'];
  near_heat: boolean;
  exposure: 'exposed' | 'sheltered' | null;
  pot_material: PlantContext['pot_material'];
  has_drainage: boolean | null;
  pot_size: PlantContext['pot_size'];
};

export const DEFAULT_CONTEXT: ContextState = {
  setting: 'indoor',
  spot: '',
  light: 'medium',
  near_heat: false,
  exposure: null,
  pot_material: 'plastic',
  has_drainage: true,
  pot_size: 'medium',
};

function Seg<T extends string | boolean | null>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button type="button" key={String(o.value)} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ContextFields({ value, onChange }: { value: ContextState; onChange: (v: ContextState) => void }) {
  const set = <K extends keyof ContextState>(k: K, v: ContextState[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <label>Where does it live?</label>
      <Seg
        value={value.setting}
        options={[
          { value: 'indoor', label: 'Indoors' },
          { value: 'outdoor', label: 'Outdoors' },
        ]}
        onChange={(v) => onChange({ ...value, setting: v, exposure: v === 'outdoor' ? (value.exposure ?? 'exposed') : null })}
      />

      <label htmlFor="spot">Spot</label>
      <input
        id="spot"
        type="text"
        value={value.spot}
        onChange={(e) => set('spot', e.target.value)}
        placeholder={value.setting === 'indoor' ? 'e.g. Kitchen windowsill' : 'e.g. Front steps'}
      />

      {value.setting === 'indoor' ? (
        <>
          <label>Light</label>
          <Seg
            value={value.light}
            options={[
              { value: 'bright_direct', label: 'Direct sun' },
              { value: 'bright_indirect', label: 'Bright' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
            onChange={(v) => set('light', v)}
          />
          <label className="toggle">
            <span>Next to a radiator or heater</span>
            <input type="checkbox" checked={value.near_heat} onChange={(e) => set('near_heat', e.target.checked)} />
          </label>
        </>
      ) : (
        <>
          <label>Sun</label>
          <Seg
            value={value.light}
            options={[
              { value: 'bright_direct', label: 'Full sun' },
              { value: 'medium', label: 'Part shade' },
              { value: 'low', label: 'Shade' },
            ]}
            onChange={(v) => set('light', v)}
          />
          <label>Does rain reach the pot?</label>
          <Seg
            value={value.exposure}
            options={[
              { value: 'exposed', label: 'Yes, exposed' },
              { value: 'sheltered', label: 'No, sheltered' },
            ]}
            onChange={(v) => set('exposure', v)}
          />
          <p className="small" style={{ marginTop: 6 }}>
            Sheltered means under eaves or against a wall, where rain barely lands.
          </p>
        </>
      )}

      <label>Pot</label>
      <Seg
        value={value.pot_material}
        options={[
          { value: 'plastic', label: 'Plastic' },
          { value: 'terracotta', label: 'Terracotta' },
          { value: 'glazed', label: 'Glazed' },
          { value: 'other', label: 'Other' },
        ]}
        onChange={(v) => set('pot_material', v)}
      />
      <div style={{ height: 8 }} />
      <Seg
        value={value.pot_size}
        options={[
          { value: 'small', label: 'Small' },
          { value: 'medium', label: 'Medium' },
          { value: 'large', label: 'Large' },
        ]}
        onChange={(v) => set('pot_size', v)}
      />
      <label className="toggle">
        <span>Has a drainage hole</span>
        <input
          type="checkbox"
          checked={value.has_drainage ?? true}
          onChange={(e) => set('has_drainage', e.target.checked)}
        />
      </label>
      {value.has_drainage === false && (
        <p className="small">No drainage is risky. Water in small amounts and tip out any pooled water.</p>
      )}
    </>
  );
}
