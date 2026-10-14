-- Daily Claire calls: morning readiness and evening debrief appointment kinds (superset; no values removed).
ALTER TABLE operator_appointments MODIFY COLUMN appointmentKind
  enum('sunday_weekly_planning','weekly_planning_callback','weekday_strategic_planning','daily_morning_readiness','daily_evening_debrief') NOT NULL;
