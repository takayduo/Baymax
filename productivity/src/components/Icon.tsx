import React from 'react';
import { AppWindow, ArrowRight, Ban, Bell, CheckCircle2, ChevronDown, Clock3, Focus,
  Grid2X2, LayoutDashboard, LoaderCircle, Palette, Play, Plus, PlusCircle, Radar,
  RotateCcw, Settings2, ShieldCheck, Square, Timer, TrendingUp, TriangleAlert,
  UserRound, X, Zap, type LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  apps: AppWindow, add: Plus, add_circle: PlusCircle, arrow_forward: ArrowRight,
  block: Ban, bolt: Zap, check_circle: CheckCircle2, close: X, dangerous: TriangleAlert,
  keyboard_arrow_down: ChevronDown, notifications: Bell, palette: Palette,
  person: UserRound, play_arrow: Play, progress_activity: LoaderCircle, radar: Radar,
  replay: RotateCcw, schedule: Clock3, settings: Settings2, tune: Settings2,
  stop: Square, timer: Timer, track_changes: Focus, verified: ShieldCheck,
  verified_user: ShieldCheck, admin_panel_settings: ShieldCheck, warning: TriangleAlert,
  space_dashboard: LayoutDashboard, grid_view: Grid2X2, query_stats: TrendingUp,
};

/** Bundled SVGs keep navigation legible offline, without a remote icon font. */
export default function Icon({ name, ...props }: React.SVGProps<SVGSVGElement> & { name: string }) {
  const Component = icons[name] || AppWindow;
  return <Component size="1em" strokeWidth={1.7} aria-hidden="true" {...props} />;
}
