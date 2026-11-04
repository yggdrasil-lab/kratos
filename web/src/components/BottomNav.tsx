import type { ActiveTab } from '../types'
import { BottomNav as SharedBottomNav } from '@yggdrasil-lab/ui'

interface BottomNavProps {
  activeTab: ActiveTab
  onChangeTab: (tab: ActiveTab) => void
  hasActiveWorkout: boolean
}

export function BottomNav({ activeTab, onChangeTab, hasActiveWorkout }: BottomNavProps) {
  const isProgressActive = activeTab === 'progress' || activeTab === 'history'
  const currentTabId = isProgressActive ? 'progress' : 'today'

  const tabs = [
    {
      id: 'today',
      label: 'Today',
      ariaLabel: 'Today dashboard and workout',
      badgeDot: hasActiveWorkout,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="16" y1="2" x2="16" y2="6"></line>
          <line x1="8" y1="2" x2="8" y2="6"></line>
          <line x1="3" y1="10" x2="21" y2="10"></line>
        </svg>
      ),
    },
    {
      id: 'progress',
      label: 'Progress',
      ariaLabel: 'Progress, 80kg Goal and Activity',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
          <polyline points="17 6 23 6 23 12"></polyline>
        </svg>
      ),
    },
  ]

  return (
    <SharedBottomNav
      className="bottom-nav"
      tabs={tabs}
      activeTab={currentTabId}
      onChangeTab={(id) => onChangeTab(id as ActiveTab)}
    />
  )
}
