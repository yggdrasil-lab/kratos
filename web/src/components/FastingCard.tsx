import { useState } from 'react'
import {
  AiSynthesizerModal,
  AlertBanner,
  Button,
  CollapsibleSection,
  GlassCard,
  LoadingState,
  SectionHeader,
  StatusBadge,
  type StatusBadgeVariant,
} from '@yggdrasil-lab/ui'
import type { FastingCheckIn, FastingRecommendation } from '../types'
import { resolveFastingProtocol, type ResolvedFastingProtocol } from '../utils/circadian'
import { FastingCheckInModal } from './FastingCheckInModal'

interface FastingCardProps {
  circadianDate: string
  dayOfWeek: number // 0 = Mon, ..., 6 = Sun
  latestCheckIn?: FastingCheckIn
  recommendation?: FastingRecommendation | null
  onSaveCheckIn: (checkIn: FastingCheckIn) => void
  onSynthesizeRecommendation?: (customContext?: string) => Promise<void>
  isGenerating?: boolean
}

const FASTING_PILLARS = [
  {
    label: 'Circadian TRE',
    description: '8-10h window ending 3-4h prior to sleep to preserve nocturnal HRV and deep sleep.',
  },
  {
    label: 'MPS Distribution',
    description: '0.4-0.5 g/kg protein spaced across 3-4 meals on lifting days with post-lift anchor.',
  },
  {
    label: 'Court Glycogen',
    description: 'Pre-match carbs and electrolytes 2-3h before play; post-match amino acids.',
  },
  {
    label: 'Metabolic Reset',
    description: '18:6 autophagy fasts reserved strictly for low-strain recovery days.',
  },
]

const RECOVERY_BADGE_MAP: Record<string, { label: string; variant: StatusBadgeVariant }> = {
  fatigued: { label: '🔴 Autoregulated', variant: 'error' },
  moderate: { label: '🟡 Moderate', variant: 'warning' },
  optimal: { label: '🟢 Primed', variant: 'success' },
}

const ADHERENCE_BADGE_MAP: Record<string, { label: string; variant: StatusBadgeVariant }> = {
  completed: { label: '✓ Completed', variant: 'success' },
  early: { label: '⚡ Early', variant: 'warning' },
  off_plan: { label: '🔴 Off-Plan', variant: 'error' },
}

function FastingHeaderActions({
  hasAiHandler,
  isCheckedInToday,
  latestCheckIn,
  onOpenAiModal,
  onOpenCheckIn,
}: {
  hasAiHandler: boolean
  isCheckedInToday: boolean
  latestCheckIn?: FastingCheckIn
  onOpenAiModal: () => void
  onOpenCheckIn: () => void
}) {
  const adherenceBadge =
    ADHERENCE_BADGE_MAP[latestCheckIn?.adherence ?? 'off_plan'] ?? ADHERENCE_BADGE_MAP.off_plan

  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {hasAiHandler && (
        <Button
          variant="outline"
          size="xs"
          icon={<span>⚡</span>}
          onClick={onOpenAiModal}
          title="Adapt protocol with AI sports physiology"
          className="border-accent/40 text-accent"
        >
          Adapt
        </Button>
      )}
      {isCheckedInToday && latestCheckIn ? (
        <StatusBadge
          label={adherenceBadge.label}
          variant={adherenceBadge.variant}
          size="sm"
          showDot={false}
          className="font-semibold"
        />
      ) : (
        <Button
          variant="outline"
          size="xs"
          onClick={onOpenCheckIn}
          className="border-accent/50 text-accent"
        >
          Log Fast
        </Button>
      )}
    </div>
  )
}

function FastingStatusBadges({
  protocol,
  hasRecommendation,
  isGenerating,
}: {
  protocol: ResolvedFastingProtocol
  hasRecommendation: boolean
  isGenerating?: boolean
}) {
  if (!hasRecommendation && !isGenerating && !protocol.isLlmGenerated) return null
  const recoveryBadge =
    RECOVERY_BADGE_MAP[protocol.recoveryStatus ?? 'optimal'] ?? RECOVERY_BADGE_MAP.optimal

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {hasRecommendation && (
        <StatusBadge
          label={recoveryBadge.label}
          variant={recoveryBadge.variant}
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      )}
      {isGenerating && (
        <StatusBadge
          label="⚡ Synthesizing AI Protocol..."
          variant="busy"
          size="xs"
          showDot={false}
          isPulsing
          className="rounded-md font-semibold"
        />
      )}
      {protocol.isLlmGenerated && (
        <StatusBadge
          label="⚡ AI Synthesized"
          variant="info"
          size="xs"
          showDot={false}
          className="rounded-md font-semibold"
        />
      )}
    </div>
  )
}

function FastingCardHeader({
  protocol,
  hasRecommendation,
  isGenerating,
  isCheckedInToday,
  latestCheckIn,
  hasAiHandler,
  onOpenAiModal,
  onOpenCheckIn,
}: {
  protocol: ResolvedFastingProtocol
  hasRecommendation: boolean
  isGenerating?: boolean
  isCheckedInToday: boolean
  latestCheckIn?: FastingCheckIn
  hasAiHandler: boolean
  onOpenAiModal: () => void
  onOpenCheckIn: () => void
}) {
  return (
    <div className="mb-3 space-y-2">
      <SectionHeader
        title="Fasting and Fueling"
        subtitle={protocol.protocolName}
        icon={<span className="text-base leading-none">⏱️</span>}
        variant="sky"
        size="md"
        actions={
          <FastingHeaderActions
            hasAiHandler={hasAiHandler}
            isCheckedInToday={isCheckedInToday}
            latestCheckIn={latestCheckIn}
            onOpenAiModal={onOpenAiModal}
            onOpenCheckIn={onOpenCheckIn}
          />
        }
      />
      <FastingStatusBadges
        protocol={protocol}
        hasRecommendation={hasRecommendation}
        isGenerating={isGenerating}
      />
    </div>
  )
}

function FastingCheckInSummary({
  latestCheckIn,
  onEdit,
}: {
  latestCheckIn: FastingCheckIn
  onEdit: () => void
}) {
  const details = [
    latestCheckIn.energy ? `Energy ${latestCheckIn.energy}` : null,
    latestCheckIn.headache ? `Headache ${latestCheckIn.headache}` : null,
    latestCheckIn.notes ? `"${latestCheckIn.notes}"` : null,
  ]
    .filter(Boolean)
    .map((part, i) => `${i === 0 ? ': ' : ' • '}${part}`)
    .join('')

  return (
    <div className="mt-3 pt-2.5 border-t border-border/50 text-xs text-slate-400 flex justify-between items-center gap-2">
      <span className="truncate">Logged{details}</span>
      <Button variant="ghost" size="xs" onClick={onEdit} className="underline text-slate-300 shrink-0">
        Edit
      </Button>
    </div>
  )
}

function FastingCardBody({
  protocol,
  isGenerating,
  hasRecommendation,
  isCheckedInToday,
  latestCheckIn,
  onEditCheckIn,
}: {
  protocol: ResolvedFastingProtocol
  isGenerating?: boolean
  hasRecommendation: boolean
  isCheckedInToday: boolean
  latestCheckIn?: FastingCheckIn
  onEditCheckIn: () => void
}) {
  return (
    <>
      {isGenerating && !hasRecommendation && (
        <LoadingState
          label="Synthesizing today's circadian fasting protocol and Discord thread..."
          variant="brand"
          className="bg-accent/10 border border-accent/20 rounded-xl py-4 mb-3"
        />
      )}

      <div className="bg-background/70 rounded-xl px-3.5 py-2.5 mb-3 flex justify-between items-center border border-border/50">
        <span className="text-xs text-slate-400">Target Window</span>
        <span className="text-xs font-semibold text-slate-100">{protocol.windowHours}</span>
      </div>

      {protocol.rationale && (
        <AlertBanner
          variant={
            protocol.recoveryStatus === 'fatigued'
              ? 'error'
              : protocol.recoveryStatus === 'moderate'
              ? 'warning'
              : 'info'
          }
          icon="🧠"
          title="Smart Autoregulation"
          className="mb-3"
        >
          {protocol.rationale}
        </AlertBanner>
      )}

      <div className="flex flex-col gap-1.5">
        {protocol.fuelingAnchors.map((anchor, idx) => (
          <div key={idx} className="text-xs text-slate-300 flex items-start gap-1.5">
            <span className="text-sky-400 mt-0.5">•</span>
            <span>{anchor}</span>
          </div>
        ))}
      </div>

      {protocol.researchCitation && (
        <CollapsibleSection variant="inline" icon="📚" title={protocol.researchCitation} className="mt-3">
          <div>☀️ <strong>Panda Lab:</strong> 8-10h feeding window ending 3-4h prior to sleep preserves nocturnal HRV &amp; deep sleep.</div>
          <div>🥩 <strong>Schoenfeld / Aragon:</strong> 0.4-0.5g/kg protein every 3-5h on lift days with an anabolic recovery anchor.</div>
          <div>🏸 <strong>Court Kinetics:</strong> Pre-match complex carbs + electrolytes 2-3h before play prevent glycogen depletion.</div>
          <div>🧬 <strong>Mattson / Longo:</strong> 18:6 autophagy fasts reserved strictly for low-strain recovery days.</div>
        </CollapsibleSection>
      )}

      {isCheckedInToday && latestCheckIn && (
        <FastingCheckInSummary latestCheckIn={latestCheckIn} onEdit={onEditCheckIn} />
      )}
    </>
  )
}

export function FastingCard({
  circadianDate,
  dayOfWeek,
  latestCheckIn,
  recommendation,
  onSaveCheckIn,
  onSynthesizeRecommendation,
  isGenerating,
}: FastingCardProps) {
  const [showModal, setShowModal] = useState<boolean>(false)
  const [showAiModal, setShowAiModal] = useState<boolean>(false)

  const protocol = resolveFastingProtocol(dayOfWeek, recommendation)
  const isCheckedInToday = Boolean(latestCheckIn && latestCheckIn.date === circadianDate)

  return (
    <>
      <GlassCard className="animate-slide-up mb-4">
        <FastingCardHeader
          protocol={protocol}
          hasRecommendation={Boolean(recommendation)}
          isGenerating={isGenerating}
          isCheckedInToday={isCheckedInToday}
          latestCheckIn={latestCheckIn}
          hasAiHandler={Boolean(onSynthesizeRecommendation)}
          onOpenAiModal={() => setShowAiModal(true)}
          onOpenCheckIn={() => setShowModal(true)}
        />
        <FastingCardBody
          protocol={protocol}
          isGenerating={isGenerating}
          hasRecommendation={Boolean(recommendation)}
          isCheckedInToday={isCheckedInToday}
          latestCheckIn={latestCheckIn}
          onEditCheckIn={() => setShowModal(true)}
        />
      </GlassCard>

      {showModal && (
        <FastingCheckInModal
          date={circadianDate}
          targetWindow={protocol.targetWindow}
          initialCheckIn={latestCheckIn}
          onSave={(checkIn) => {
            onSaveCheckIn(checkIn)
            setShowModal(false)
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {onSynthesizeRecommendation && (
        <AiSynthesizerModal
          isOpen={showAiModal}
          onClose={() => setShowAiModal(false)}
          title="Adaptive Fasting Synthesizer"
          subtitle="Sports Physiology & Circadian Research Grounding"
          citationTitle={protocol.researchCitation || 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)'}
          pillars={FASTING_PILLARS}
          inputLabel="Day Shifts or Custom Schedule (Optional)"
          inputPlaceholder="e.g. Lunch at 1:30 PM with team; badminton moved to 7:00 PM; feeling slightly sore from deadlifts"
          submitLabel="Synthesize with AI"
          onSynthesize={onSynthesizeRecommendation}
        />
      )}
    </>
  )
}
