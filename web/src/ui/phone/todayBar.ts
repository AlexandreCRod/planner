/**
 * Today's top bar's own buttons, left to right, before Search and Settings (341). The Today button shows away from
 * today only. With the "Tasks button: On" look, the Tasks button shows on every day (the user, 2026-11-07; it was
 * today only). So the bar still fits with Today, Tasks, the to-dos, Search and Settings (review of 2.10.2, finding 2:
 * Settings once went off the screen), the look draws the bar a little tighter on every day (phone.css,
 * `.p-appbar.has-tasks`: the arrows 40 px, the icons 44, a smaller title slot), so the arrows stay still from day to day.
 */
export type TodayBarButton = "today" | "tasks" | "todos";
export function todayBarButtons(isToday: boolean, tasksButton: boolean): TodayBarButton[] {
  const own: TodayBarButton[] = tasksButton ? ["tasks", "todos"] : ["todos"];
  return isToday ? own : ["today", ...own];
}
