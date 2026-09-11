import { Home, CalendarDays, Newspaper, Beer, Archive, BarChart3, LayoutDashboard, Lightbulb, MoreHorizontal, ImageIcon } from "lucide-react";

// ---- NAV ICON (Lucide, outline, monochroom voor de navigatie) ----
const NAV_ICONS = {
  home: Home,
  agenda: CalendarDays,
  nieuws: Newspaper,
  bardienst: Beer,
  archief: Archive,
  statistieken: BarChart3,
  dashboard: LayoutDashboard,
  idee: Lightbulb,
  ideeen: Lightbulb,
  fotos: ImageIcon,
  meer: MoreHorizontal,
};

export default function NavIcon({ name, size = 20 }) {
  const Icon = NAV_ICONS[name];
  if (!Icon) return null;
  return <Icon size={size} strokeWidth={1.8} />;
}
