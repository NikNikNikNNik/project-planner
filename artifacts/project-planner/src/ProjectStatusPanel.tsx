import { useMemo, useState } from "react";
import type { Project, ActualRecord } from "@workspace/api-client-react";
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardList, Pencil, Plus, Trash2, X } from "lucide-react";
import { getStatusReport, validateActualRecord } from "./project-status";

type Records = NonNullable<Project["settings"]["actualRecords"]>;
type Kind = ActualRecord["kind"];
type Mode = NonNullable<ActualRecord["deliveryMode"]>;

interface Props {
  project: Project;
  onChange: (records: Records) => void;
}

const KIND_LABEL: Record<Kind, string> = {
  hire: "Найм",
  training: "Обучение",
  payroll: "ФОТ",
  training_cost: "Затраты на обучение",
};
const MODE_LABEL: Record<Mode, string> = { online: "Онлайн", atyrau: "Атырау", offsite: "Выездное" };

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function fmtDate(s: string): string {
  if (!isRealDate(s)) return s;
  const [y, m, d] = s.split("-");
  return `${d}.${m}.${y}`;
}
const numFmt = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
const fmtNum = (n: number) => (Number.isFinite(n) ? numFmt.format(n) : "—");
const fmtPct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${numFmt.format(n)}%`);
const fmtSigned = (n: number) => (n > 0 ? `+${fmtNum(n)}` : fmtNum(n));
const fmtSignedPct = (n: number | null) => (n === null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${numFmt.format(n)}%`);
const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `ar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

interface FormState {
  id: string | null;
  date: string;
  kind: Kind;
  shopId: string;
  roleId: string;
  eventId: string;
  deliveryMode: Mode | "";
  people: string;
  days: string;
  amountKzt: string;
  note: string;
}

const emptyForm = (shopId: string): FormState => ({
  id: null, date: localToday(), kind: "hire", shopId, roleId: "", eventId: "", deliveryMode: "",
  people: "", days: "", amountKzt: "", note: "",
});

type Row = ReturnType<typeof getStatusReport>["rows"][number];

function MetricsTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-[#e5e1d7] text-left text-[10px] uppercase tracking-wide text-[#85877e]">
            <th className="px-3 py-2 font-bold">Показатель</th>
            <th className="bg-[#f1f4ef] px-3 py-2 text-right font-bold">План всего</th>
            <th className="px-3 py-2 text-right font-bold">План на дату</th>
            <th className="px-3 py-2 text-right font-bold">Факт</th>
            <th className="px-3 py-2 text-right font-bold">Факт / план</th>
            <th className="px-3 py-2 text-right font-bold">Дельта</th>
            <th className="px-3 py-2 text-right font-bold">Откл. / план</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-[#efece4] last:border-0">
              <td className="px-3 py-2 font-semibold text-[#293640]">{r.label}<span className="ml-1 font-normal text-[#8a8b82]">{r.unit}</span></td>
              <td className="mono bg-[#f1f4ef] px-3 py-2 text-right font-semibold text-[#416a5d]">{fmtNum(r.totalPlan)}</td>
              <td className="mono px-3 py-2 text-right">{fmtNum(r.plan)}</td>
              <td className="mono px-3 py-2 text-right font-semibold">{r.hasFact ? fmtNum(r.fact) : <span className="font-normal text-[#8a8b82]">нет данных</span>}</td>
              <td className="mono px-3 py-2 text-right">{r.hasFact ? fmtPct(r.percent) : "—"}</td>
              <td className={`mono px-3 py-2 text-right font-semibold ${!r.hasFact ? "text-[#6f7774]" : r.delta < 0 ? "text-[#a7472e]" : r.delta > 0 ? "text-[#3d6b55]" : "text-[#6f7774]"}`}>{r.hasFact ? fmtSigned(r.delta) : "—"}</td>
              <td className={`mono px-3 py-2 text-right ${r.hasFact && r.delta < 0 ? "text-[#a7472e]" : "text-[#6f7774]"}`}>{r.hasFact ? fmtSignedPct(r.deltaPercent) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-center text-[#8a8b82]">Нет показателей</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectStatusPanel({ project, onChange }: Props) {
  const records: Records = project.settings.actualRecords ?? [];
  const today = localToday();
  const [asOf, setAsOf] = useState(today);
  const [openShops, setOpenShops] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const dateValid = isRealDate(asOf);
  const report = useMemo(() => (dateValid ? getStatusReport(project, asOf) : null), [project, asOf, dateValid]);

  const shopById = useMemo(() => new Map(project.shops.map(s => [s.id, s])), [project.shops]);
  const eventById = useMemo(() => new Map(project.training.map(e => [e.id, e])), [project.training]);
  const roleName = (shopId: string, roleId?: string) => (roleId ? shopById.get(shopId)?.roles.find(r => r.id === roleId)?.name ?? "удалённая роль" : null);

  const formShop = form ? shopById.get(form.shopId) : undefined;
  const formRoles = formShop?.roles ?? [];
  const formEvents = form ? project.training.filter(e => e.shopIds.includes(form.shopId) && (!form.roleId || e.roleIds.length === 0 || e.roleIds.includes(form.roleId) || e.id === form.eventId)) : [];

  const upd = (patch: Partial<FormState>) => setForm(f => (f ? { ...f, ...patch } : f));

  const startAdd = () => { setErrors([]); setForm(emptyForm(project.shops[0]?.id ?? "")); };
  const startEdit = (r: ActualRecord) => {
    setErrors([]);
    setForm({
      id: r.id, date: r.date, kind: r.kind, shopId: r.shopId, roleId: r.roleId ?? "", eventId: r.eventId ?? "",
      deliveryMode: r.deliveryMode ?? "", people: r.people != null ? String(r.people) : "", days: r.days != null ? String(r.days) : "",
      amountKzt: r.amountKzt != null ? String(r.amountKzt) : "", note: r.note ?? "",
    });
  };

  const submit = () => {
    if (!form) return;
    const errs: string[] = [];
    if (!isRealDate(form.date)) errs.push("Укажите корректную дату.");
    else if (form.date > today) errs.push("Дата факта не может быть в будущем.");
    if (!form.shopId) errs.push("Выберите цех.");
    const rec: ActualRecord = { id: form.id ?? newId(), date: form.date, kind: form.kind, shopId: form.shopId };
    const parseNum = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".").replace(/\s/g, "")));
    if (form.kind === "hire" || form.kind === "training") {
      if (!form.roleId) errs.push("Выберите роль.");
      else rec.roleId = form.roleId;
      const p = parseNum(form.people);
      if (!Number.isInteger(p) || p < 1) errs.push("Количество человек — целое число не меньше 1.");
      else rec.people = p;
    }
    if (form.kind === "training") {
      if (!form.eventId) errs.push("Выберите мероприятие обучения.");
      else rec.eventId = form.eventId;
      if (!form.deliveryMode) errs.push("Укажите формат проведения.");
      else rec.deliveryMode = form.deliveryMode;
      const d = parseNum(form.days);
      if (!Number.isFinite(d) || d <= 0) errs.push("Фактические дни должны быть больше 0.");
      else rec.days = d;
    }
    if (form.kind === "payroll" || form.kind === "training_cost") {
      if (form.kind === "payroll" && form.roleId) rec.roleId = form.roleId;
      if (form.kind === "training_cost" && form.eventId) rec.eventId = form.eventId;
      const a = parseNum(form.amountKzt);
      if (!Number.isFinite(a) || a < 0) errs.push("Сумма в KZT должна быть числом не меньше 0.");
      else rec.amountKzt = a;
    }
    if (form.note.trim()) rec.note = form.note.trim();
    if (errs.length === 0) errs.push(...validateActualRecord(project, rec));
    if (errs.length) { setErrors(errs); return; }
    const next = form.id ? records.map(r => (r.id === form.id ? rec : r)) : [...records, rec];
    onChange(next);
    setForm(null);
    setErrors([]);
  };

  const doDelete = (id: string) => {
    onChange(records.filter(r => r.id !== id));
    setConfirmDelete(null);
    if (form?.id === id) setForm(null);
  };

  const sorted = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date)), [records]);

  const detail = (r: ActualRecord) => {
    const parts: string[] = [];
    const rn = roleName(r.shopId, r.roleId); if (rn) parts.push(rn);
    if (r.eventId) parts.push(eventById.get(r.eventId)?.title ?? "удалённое мероприятие");
    if (r.people != null) parts.push(`${r.people} чел.`);
    if (r.days != null) parts.push(`${fmtNum(r.days)} дн.`);
    if (r.people != null && r.days != null) parts.push(`= ${fmtNum(r.people * r.days)} чел.-дн.`);
    if (r.deliveryMode) parts.push(MODE_LABEL[r.deliveryMode]);
    if (r.amountKzt != null) parts.push(`${fmtNum(r.amountKzt)} KZT`);
    return parts.join(" · ");
  };

  return (
    <div className="panel overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e1d7] px-4 py-3.5 md:px-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e9e5d9] text-[#586764]"><ClipboardList size={15} /></div>
          <div><h2 className="text-sm font-extrabold">Статусы: ПЛАН–ФАКТ–ДЕЛЬТА</h2><p className="text-[10px] text-[#8a8b82]">Общий план проекта и накопительные показатели на дату отчёта. Факт — только из журнала.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-[#85877e]">на дату
            <input aria-label="Дата отчёта" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className="control h-7 w-[130px] px-1.5 text-[11px]" />
          </label>
          <button type="button" onClick={() => setAsOf(today)} className="h-7 rounded-md border border-[#dfdbcf] px-2 text-[10px] font-semibold">Сегодня</button>
          <button type="button" onClick={() => setAsOf(project.endDate)} className="h-7 rounded-md border border-[#dfdbcf] px-2 text-[10px] font-semibold">Конец проекта</button>
        </div>
      </div>

      <div className="space-y-3 p-4 md:p-5">
        <p className="text-[10px] text-[#6f7774]">Дельта = факт − план на выбранную дату; проценты — относительно плана на эту дату. При нулевом плане процент не определён. Положительная дельта расходов означает превышение плана. Онбординг не входит в человеко-дни обучения. Общие затраты события распределяются по цехам пропорционально числу участников. Исключённые из расчёта цеха и роли не учитываются.</p>
        <p className="text-[10px] text-[#6f7774]">«План всего» включает всю плановую численность, человеко-дни и известный бюджет всех назначенных обучений, независимо от даты отчёта. ФОТ в этом столбце рассчитан от контрактов до конца проекта — {fmtDate(project.endDate)}. При отсутствии фактических записей по показателю факт и отклонения не определены.</p>
        {!dateValid && (
          <div className="flex items-start gap-2 rounded-lg bg-[#f8e9df] px-3 py-2 text-[11px] font-semibold text-[#a7472e]">
            <AlertTriangle size={14} className="mt-px shrink-0" />Укажите корректную дату отчёта. Расчёт приостановлен.
          </div>
        )}
        {report && (
          <>
            {asOf > today && <p className="rounded-lg bg-[#eef3f6] px-3 py-2 text-[11px] text-[#416477]">Прогноз на будущую дату. План рассчитан на {fmtDate(asOf)}; факт содержит только уже внесённые записи, не прогноз.</p>}
            {report.firstPlannedDate && report.firstPlannedDate > asOf && report.rows.every(r => r.plan === 0) && report.rows.some(r => r.totalPlan > 0) && (
              <p className="rounded-lg bg-[#eef4ed] px-3 py-2 text-[11px] text-[#49685b]">
                На {fmtDate(asOf)} по плану ещё нет найма, обучения и затрат. Полный объём данных виден в столбце «План всего».
                {report.firstPlannedDate && report.firstPlannedDate > asOf && ` Первое плановое событие — ${fmtDate(report.firstPlannedDate)}.`}
              </p>
            )}
            {records.length === 0 && (
              <div className="rounded-lg border border-dashed border-[#dfdbcf] bg-[#f6f4ee] px-3 py-2 text-[11px] text-[#6f7774]">
                Подтверждённых фактических записей нет — в колонке «Факт» показано «нет данных». Статус мероприятий в плане не считается фактом; добавьте записи в журнал ниже.
              </div>
            )}
            {report.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-[#f8e9df] px-3 py-2 text-[11px] text-[#a7472e]">
                {report.warnings.map((w, i) => <li key={i} className="flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{w}</li>)}
              </ul>
            )}
            <div className="rounded-lg border border-[#e5e1d7]"><MetricsTable rows={report.rows} /></div>
            <div className="space-y-1.5">
              {report.shops.map(s => {
                const open = !!openShops[s.shopId];
                return (
                  <div key={s.shopId} className="rounded-lg border border-[#e5e1d7]">
                    <button type="button" aria-expanded={open} onClick={() => setOpenShops(o => ({ ...o, [s.shopId]: !open }))} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-bold text-[#293640] hover:bg-[#f6f4ee]">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{s.shopName}
                    </button>
                    {open && <div className="border-t border-[#e5e1d7]"><MetricsTable rows={s.rows} /></div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="border-t border-[#e5e1d7] pt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-extrabold">Журнал фактов <span className="font-normal text-[#8a8b82]">({records.length})</span></h3>
            {!form && <button type="button" onClick={startAdd} disabled={project.shops.length === 0} className="inline-flex h-7 items-center gap-1 rounded-md bg-[#293640] px-2.5 text-[11px] font-bold text-[#f6f4ee] disabled:opacity-50"><Plus size={13} />Добавить запись</button>}
          </div>

          {form && (
            <div className="mb-3 rounded-lg border border-[#dfdbcf] bg-[#f6f4ee] p-3">
              <div className="mb-2 flex items-center justify-between"><span className="text-[11px] font-bold">{form.id ? "Редактирование записи" : "Новая запись"}</span>
                <button type="button" aria-label="Отмена" onClick={() => { setForm(null); setErrors([]); }} className="text-[#6f7774]"><X size={14} /></button></div>
              <div className="grid grid-cols-1 gap-2 text-[10px] text-[#85877e] sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1">Дата<input type="date" max={today} value={form.date} onChange={e => upd({ date: e.target.value })} className="control h-8 px-2 text-[11px]" /></label>
                <label className="flex flex-col gap-1">Тип<select value={form.kind} onChange={e => upd({ kind: e.target.value as Kind })} className="control h-8 px-2 text-[11px]">
                  {(Object.keys(KIND_LABEL) as Kind[]).map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
                <label className="flex flex-col gap-1">Цех<select value={form.shopId} onChange={e => upd({ shopId: e.target.value, roleId: "", eventId: "", deliveryMode: "" })} className="control h-8 px-2 text-[11px]">
                  {project.shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
                {form.kind !== "training_cost" && (
                  <label className="flex flex-col gap-1">Роль{form.kind === "payroll" ? " (необязательно)" : ""}<select value={form.roleId} onChange={e => upd({ roleId: e.target.value })} className="control h-8 px-2 text-[11px]">
                    <option value="">{form.kind === "payroll" ? "Все роли цеха" : "Выберите роль"}</option>
                    {formRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
                )}
                {(form.kind === "training" || form.kind === "training_cost") && (
                  <label className="flex flex-col gap-1">Мероприятие{form.kind === "training_cost" ? " (необязательно)" : ""}<select value={form.eventId} onChange={e => { const ev = eventById.get(e.target.value); upd({ eventId: e.target.value, deliveryMode: form.kind === "training" ? (ev?.deliveryMode ?? "") : "" }); }} className="control h-8 px-2 text-[11px]">
                    <option value="">{form.kind === "training_cost" ? "Без привязки" : "Выберите мероприятие"}</option>
                    {formEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}</select></label>
                )}
                {form.kind === "training" && (
                  <label className="flex flex-col gap-1">Формат<select value={form.deliveryMode} onChange={e => upd({ deliveryMode: e.target.value as Mode | "" })} className="control h-8 px-2 text-[11px]">
                    <option value="">Выберите формат</option>
                    {(Object.keys(MODE_LABEL) as Mode[]).map(m => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}</select></label>
                )}
                {(form.kind === "hire" || form.kind === "training") && (
                  <label className="flex flex-col gap-1">Человек<input type="number" min={1} step={1} inputMode="numeric" value={form.people} onChange={e => upd({ people: e.target.value })} className="control mono h-8 px-2 text-[11px]" /></label>
                )}
                {form.kind === "training" && (
                  <label className="flex flex-col gap-1">Фактических дней<input type="number" min={0} step="any" inputMode="decimal" value={form.days} onChange={e => upd({ days: e.target.value })} className="control mono h-8 px-2 text-[11px]" /></label>
                )}
                {(form.kind === "payroll" || form.kind === "training_cost") && (
                  <label className="flex flex-col gap-1">Сумма, KZT<input type="number" min={0} step="any" inputMode="decimal" value={form.amountKzt} onChange={e => upd({ amountKzt: e.target.value })} className="control mono h-8 px-2 text-[11px]" /></label>
                )}
                <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">Комментарий<input value={form.note} maxLength={1000} onChange={e => upd({ note: e.target.value })} className="control h-8 px-2 text-[11px]" placeholder="Источник: приказ, ведомость, акт" /></label>
              </div>
              {errors.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] font-semibold text-[#a7472e]">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => { setForm(null); setErrors([]); }} className="h-7 rounded-md border border-[#dfdbcf] px-2.5 text-[11px] font-semibold">Отмена</button>
                <button type="button" onClick={submit} className="h-7 rounded-md bg-[#293640] px-3 text-[11px] font-bold text-[#f6f4ee]">{form.id ? "Сохранить" : "Добавить"}</button>
              </div>
            </div>
          )}

          {sorted.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#dfdbcf] px-3 py-4 text-center text-[11px] text-[#8a8b82]">Журнал пуст. Фактические данные появятся только после добавления записей.</p>
          ) : (
            <ul className="divide-y divide-[#efece4] rounded-lg border border-[#e5e1d7]">
              {sorted.map(r => (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-[11px]">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mono font-semibold">{fmtDate(r.date)}</span>
                      <span className="rounded bg-[#e9e5d9] px-1.5 py-0.5 text-[10px] font-bold text-[#586764]">{KIND_LABEL[r.kind]}</span>
                      <span className="font-semibold text-[#293640]">{shopById.get(r.shopId)?.name ?? "удалённый цех"}</span>
                      {r.date > asOf && dateValid && <span className="text-[10px] text-[#8a8b82]">после даты отчёта</span>}
                    </div>
                    <div className="mt-0.5 break-words text-[#6f7774]">{detail(r)}</div>
                    {r.note && <div className="mt-0.5 break-words italic text-[#8a8b82]">{r.note}</div>}
                  </div>
                  {confirmDelete === r.id ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold text-[#a7472e]">Удалить запись?</span>
                      <button type="button" onClick={() => doDelete(r.id)} className="h-6 rounded bg-[#a7472e] px-2 text-[10px] font-bold text-[#f6f4ee]">Удалить</button>
                      <button type="button" onClick={() => setConfirmDelete(null)} className="h-6 rounded border border-[#dfdbcf] px-2 text-[10px]">Нет</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Изменить запись" onClick={() => startEdit(r)} className="flex h-6 w-6 items-center justify-center rounded text-[#586764] hover:bg-[#e9e5d9]"><Pencil size={12} /></button>
                      <button type="button" aria-label="Удалить запись" onClick={() => setConfirmDelete(r.id)} className="flex h-6 w-6 items-center justify-center rounded text-[#a7472e] hover:bg-[#f8e9df]"><Trash2 size={12} /></button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default ProjectStatusPanel;
