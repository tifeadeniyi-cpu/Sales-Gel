import {
  BarChart3, Bell, BookOpen, CheckCircle2, CreditCard, FileInput, Filter, Inbox, KanbanSquare, LayoutDashboard,
  LifeBuoy, LineChart, Megaphone, MessagesSquare, Package, Plug, Settings, ShieldCheck, ShoppingBag, Ticket, Users,
  Workflow, Zap, Mail, Phone, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  BarChart3, Bell, BookOpen, CheckCircle2, CreditCard, FileInput, Filter, Inbox, KanbanSquare, LayoutDashboard,
  LifeBuoy, LineChart, Megaphone, MessagesSquare, Package, Plug, Settings, ShieldCheck, ShoppingBag, Ticket, Users,
  Workflow, Zap, Mail, Phone,
};

export function NavIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? LayoutDashboard;
  return <Icon className={className} aria-hidden />;
}
