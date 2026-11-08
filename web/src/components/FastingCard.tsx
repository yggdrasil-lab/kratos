import { useState } from 'react'
import { GlassCard, Button, AlertBanner, CollapsibleSection, AiSynthesizerModal } from '@yggdrasil-lab/ui'
import type { FastingCheckIn, FastingRecommendation } from '../types'
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
    description: 'Pre-match carbs and electrolytes 2-3h before badminton; post-match amino acids.',
  },
  {
    label: 'Metabolic Reset',
    description: '18:6 autophagy fasts reserved strictly for low-strain recovery days.',
  },
]

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

  let protocolName = recommendation?.protocol_name ?? '16:8 Standard Split'
  let targetWindow = recommendation?.target_window ?? '16:8'
  let windowHours = recommendation?.window_hours ?? '12:30 PM - 8:30 PM'
  let fuelingAnchors: string[] = recommendation?.fueling_anchors ?? [
    '12:30 PM: Break fast with 40g protein + complex carbs',
    '07:00 PM: High protein dinner + greens',
    'Post-Dinner: 15-20 min walk to blunt glucose spike',
  ]
  const rationale = recommendation?.rationale
  const recoveryStatus = recommendation?.recovery_status
  const isLlmGenerated = recommendation?.is_llm_generated ?? false
  const researchCitation = recommendation?.research_citation

  if (!recommendation) {
    if (dayOfWeek === 5 || dayOfWeek === 6) {
      protocolName = '14:10 Social Baseline'
      targetWindow = '14:10'
      windowHours = '10:30 AM - 8:30 PM'
      fuelingAnchors = [
        'Mindful portions with family and friends',
        'Prioritize hydration and avoid high-sugar snacks',
      ]
    } else {
      protocolName = '16:8 Circadian Protocol'
      targetWindow = '16:8'
      windowHours = '12:00 PM - 8:00 PM'
      fuelingAnchors = [
        'Morning: High water intake and electrolyte hydration',
        '12:00 PM: Balanced lunch with clean complex carbs and protein',
        '07:00 PM: High-protein dinner (close window by 8:00 PM)',
      ]
    }
  }

  const isCheckedInToday = latestCheckIn && latestCheckIn.date === circadianDate

  const recoveryBadgeClass =
    recoveryStatus === 'fatigued'
      ? 'bg-rose-500/20 text-rose-400'
      : recoveryStatus === 'moderate'
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-emerald-500/20 text-emerald-400'

  const adherenceBadgeClass =
    latestCheckIn?.adherence === 'completed'
      ? 'bg-emerald-500/20 text-emerald-400'
      : latestCheckIn?.adherence === 'early'
      ? 'bg-amber-500/20 text-amber-400'
      : 'bg-rose-500/20 text-rose-400'

  return (
    <>
      <GlassCard className="animate-slide-up mb-5">
        {/* Header */}
        <div className="flex justify-between items-center mb-3 gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">⏱️</span>
            <div>
              <div className="font-bold text-sm text-slate-100">
                Fasting and Fueling
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-xs text-sky-400 font-semibold">
                  {protocolName}
                </span>
                {recommendation && (
                  <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-semibold ${recoveryBadgeClass}`}>
                    {recoveryStatus === 'fatigued' ? '🔴 Autoregulated' : recoveryStatus === 'moderate' ? '🟡 Moderate' : '🟢 Primed'}
                  </span>
                )}
                {isGenerating && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold bg-amber-500/25 text-amber-300 animate-pulse">
                    ⚡ Synthesizing AI Protocol...
                  </span>
                )}
                {isLlmGenerated && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded-md font-semibold bg-blue-500/25 text-blue-300">
                    ⚡ AI Synthesized
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onSynthesizeRecommendation && (
              <Button
                variant="outline"
                size="xs"
                icon={<span>⚡</span>}
                onClick={() => setShowAiModal(true)}
                title="Adapt protocol with AI sports physiology"
                className="border-blue-500/40 text-blue-300"
              >
                Adapt
              </Button>
            )}

            {isCheckedInToday ? (
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${adherenceBadgeClass}`}>
                {latestCheckIn.adherence === 'completed' ? '✓ Completed' : latestCheckIn.adherence === 'early' ? '⚡ Early' : '🔴 Off-Plan'}
              </span>
            ) : (
              <Button
                variant="outline"
                size="xs"
                onClick={() => setShowModal(true)}
                className="border-blue-500/50 text-sky-400"
              >
                Log Fast
              </Button>
            )}
          </div>
        </div>

        {isGenerating && !recommendation && (
          <div className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 mb-3 text-xs text-sky-200 flex items-center gap-2 animate-pulse">
            <span className="text-sm">⏳</span>
            <span>Synthesizing today's circadian fasting protocol and Discord thread...</span>
          </div>
        )}

        {/* Target Window Bar */}
        <div className="bg-background/70 rounded-xl px-3.5 py-2.5 mb-3 flex justify-between items-center border border-border/50">
          <span className="text-xs text-slate-400">Target Window</span>
          <span className="text-xs font-semibold text-slate-100">{windowHours}</span>
        </div>

        {/* Smart Autoregulation Rationale */}
        {rationale && (
          <AlertBanner
            variant={
              recoveryStatus === 'fatigued'
                ? 'error'
                : recoveryStatus === 'moderate'
                ? 'warning'
                : 'info'
            }
            icon="🧠"
            title="Smart Autoregulation"
            className="mb-3"
          >
            {rationale}
          </AlertBanner>
        )}

        {/* Fueling Anchors List */}
        <div className="flex flex-col gap-1.5">
          {fuelingAnchors.map((anchor, idx) => (
            <div key={idx} className="text-xs text-slate-300 flex items-start gap-1.5">
              <span className="text-sky-400 mt-0.5">•</span>
              <span>{anchor}</span>
            </div>
          ))}
        </div>

        {/* Research Grounding Accordion */}
        {researchCitation && (
          <CollapsibleSection
            variant="inline"
            icon="📚"
            title={researchCitation}
            className="mt-3"
          >
            <div>☀️ <strong>Panda Lab:</strong> 8-10h feeding window ending 3-4h prior to sleep preserves nocturnal HRV & deep sleep.</div>
            <div>🥩 <strong>Schoenfeld / Aragon:</strong> 0.4-0.5g/kg protein every 3-5h on lift days with an anabolic recovery anchor.</div>
            <div>🏸 <strong>Court Kinetics:</strong> Pre-match complex carbs + electrolytes 2-3h before play prevent glycogen depletion.</div>
            <div>🧬 <strong>Mattson / Longo:</strong> 18:6 autophagy fasts reserved strictly for low-strain recovery days.</div>
          </CollapsibleSection>
        )}

        {/* Existing Check-In Summary if already logged */}
        {isCheckedInToday && (
          <div className="mt-3 pt-2.5 border-t border-border/50 text-xs text-slate-400 flex justify-between items-center gap-2">
            <span className="truncate">
              Logged: Energy {latestCheckIn.energy} • Headache {latestCheckIn.headache}
              {latestCheckIn.notes ? ` • "${latestCheckIn.notes}"` : ''}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setShowModal(true)}
              className="underline text-slate-300 shrink-0"
            >
              Edit
            </Button>
          </div>
        )}
      </GlassCard>

      {showModal && (
        <FastingCheckInModal
          date={circadianDate}
          targetWindow={targetWindow}
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
          citationTitle={researchCitation || 'Panda Lab (Circadian TRE) & Schoenfeld (MPS Distribution)'}
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
