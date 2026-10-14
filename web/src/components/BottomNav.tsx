import type { ActiveTab } from '../types'

interface BottomNavProps {
  activeTab: ActiveTab
  onChangeTab: (tab: ActiveTab) => void
  hasActiveWorkout: boolean
}

export function BottomNav({ activeTab, onChangeTab, hasActiveWorkout }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <div className="bottom-nav-container">
        <button
          className={`bottom-nav-item ${activeTab === 'train' ? 'active' : ''}`}
          onClick={() => onChangeTab('train')}
          aria-label="Train workout"
        >
          <div className="nav-icon-wrapper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 18h12"></path>
              <path d="M6 14h12"></path>
              <rect width="18" height="8" x="3" y="2" rx="2"></rect>
            </svg>
            {hasActiveWorkout && <span className="active-workout-dot" title="Workout in progress" />}
          </div>
          <span className="nav-label">Train</span>
        </button>

        <button
          className={`bottom-nav-item ${activeTab === 'week' ? 'active' : ''}`}
          onClick={() => onChangeTab('week')}
          aria-label="Weekly workout schedule"
        >
          <div className="nav-icon-wrapper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
          </div>
          <span className="nav-label">Week</span>
        </button>

        <button
          className={`bottom-nav-item ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => onChangeTab('history')}
          aria-label="Workout history"
        >
          <div className="nav-icon-wrapper">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <span className="nav-label">History</span>
        </button>
      </div>
    </nav>
  )
}
