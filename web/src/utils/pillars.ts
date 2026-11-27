import type { AiSynthesizerPillar } from '@yggdrasil-lab/ui'

export type PillarDomain = 'workout'

export interface SciencePillar {
  id: string
  icon: string
  inlineLabel: string
  modalLabel: string
  description: string
}

const CITATION_TITLES: Record<PillarDomain, string> = {
  workout: 'Israetel (Volume Landmarks) & Helms (RIR Autoregulation)',
}

export const SCIENCE_PILLARS: Record<PillarDomain, readonly SciencePillar[]> = {
  workout: [
    {
      id: 'volume',
      icon: '📊',
      inlineLabel: 'Israetel (RP):',
      modalLabel: 'Volume Landmarks (RP)',
      description: 'Sets scaled between MEV (2 sets deload on fatigue) and MAV (3+ overload sets).',
    },
    {
      id: 'rir',
      icon: '🎯',
      inlineLabel: 'Helms:',
      modalLabel: 'RIR Autoregulation',
      description: 'Target RIR dictated by recovery score (RIR 1-2 on primed days; RIR 3-4 on fatigue).',
    },
    {
      id: 'joint',
      icon: '🛡️',
      inlineLabel: 'McGill / Starrett:',
      modalLabel: 'Joint Sparing (McGill)',
      description: 'Neutral grips and joint-sparing variations to spare impinged shoulders/spine.',
    },
    {
      id: 'court',
      icon: '🏸',
      inlineLabel: 'Concurrent Interference:',
      modalLabel: 'Court Freshness',
      description: 'Preserves leg power and avoids eccentric damage adjacent to badminton match play.',
    },
  ],
}

export function getInlinePillars(domain: PillarDomain): { icon: string; label: string; description: string }[] {
  return SCIENCE_PILLARS[domain].map((p) => ({
    icon: p.icon,
    label: p.inlineLabel,
    description: p.description,
  }))
}

export function getModalPillars(domain: PillarDomain): AiSynthesizerPillar[] {
  return SCIENCE_PILLARS[domain].map((p) => ({
    label: p.modalLabel,
    description: p.description,
  }))
}

export function getDefaultCitationTitle(domain: PillarDomain): string {
  return CITATION_TITLES[domain]
}
