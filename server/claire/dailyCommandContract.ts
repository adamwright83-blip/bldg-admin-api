/**
 * Stable Daily Command contract.
 *
 * Downstream readers — including Weekly Mission readiness — import this
 * module and not the Daily Command implementation. `loadDailyCommand` reads
 * authoritative business records and returns a derived picture.
 *
 * Authority: none.
 *
 * It does not project or confirm recurrence, designate or create a primary,
 * write Day Director rows, overwrite WeeklyIntent history, create ops tasks,
 * mutate campaigns, call Narrator OS, grant Brain V2 production authority,
 * or plan a week.
 *
 * A future locked weekly primary may wrap the returned picture. This module
 * does not load, lock, or store that history.
 */

export type { DailyCommand, DailyCommandItem } from "../../shared/claireWorkdayCommand";
export { loadDailyCommand, type LoadDailyCommandInput } from "./workdayCommandService";
