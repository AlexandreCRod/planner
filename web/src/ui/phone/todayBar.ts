/**
 * Today's top bar's own buttons, left to right, before Search and Settings (341). The Today button shows away from
 * today only. With the "Tasks button: On" look, the Tasks button shows on today only: away from today, Today takes
 * its spot, so the bar never holds more than four icons plus the arrows and the title (review of 2.10.2, finding 2:
 * with both, Settings went off the screen). The look also takes 8 px off the title's slot on every day
 * (phone.css, `.p-appbar.has-tasks`), so the arrows stay still from day to day.
 */
export type TodayBarButton = "today" | "tasks" | "todos";
export function todayBarButtons(isToday: boolean, tasksButton: boolean): TodayBarButton[] {
  if (!isToday) return ["today", "todos"];
  return tasksButton ? ["tasks", "todos"] : ["todos"];
}
