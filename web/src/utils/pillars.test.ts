import { describe, expect, it } from 'vitest'
import {
  getDefaultCitationTitle,
  getInlinePillars,
  getModalPillars,
  SCIENCE_PILLARS,
  type PillarDomain,
} from './pillars'

describe('science pillar registry', () => {
  const domains: PillarDomain[] = ['workout', 'fasting']

  it('provides four non-empty pillars and citation titles per domain without em/en dashes', () => {
    for (const domain of domains) {
      expect(SCIENCE_PILLARS[domain]).toHaveLength(4)
      expect(getInlinePillars(domain)).toHaveLength(4)
      expect(getModalPillars(domain)).toHaveLength(4)
      expect(getDefaultCitationTitle(domain).length).toBeGreaterThan(0)

      for (const pillar of SCIENCE_PILLARS[domain]) {
        expect(pillar.inlineLabel.length).toBeGreaterThan(0)
        expect(pillar.modalLabel.length).toBeGreaterThan(0)
        expect(pillar.description).not.toMatch(/[\u2013\u2014]/)
      }
    }
  })

  it('keeps expected modal and inline labels for workout and fasting cards', () => {
    const workoutModalLabels = getModalPillars('workout').map((p) => p.label)
    expect(workoutModalLabels).toEqual([
      'Volume Landmarks (RP)',
      'RIR Autoregulation',
      'Joint Sparing (McGill)',
      'Court Freshness',
    ])

    const fastingInlineLabels = getInlinePillars('fasting').map((p) => p.label)
    expect(fastingInlineLabels).toEqual([
      'Panda Lab:',
      'Schoenfeld / Aragon:',
      'Court Kinetics:',
      'Mattson / Longo:',
    ])
  })
})
