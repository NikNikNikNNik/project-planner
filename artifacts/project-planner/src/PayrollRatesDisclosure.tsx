import type { Project } from '@workspace/api-client-react';
import { ChevronDown } from 'lucide-react';
import { isRoleIncludedInCalculation } from './calculation-scope.ts';
import { formatKzt } from './payroll';

export function PayrollRatesDisclosure({
  project,
  onRateChange,
}: {
  project: Project;
  onRateChange: (shopId: string, roleId: string, rate: number | undefined) => void;
}) {
  const roleCount = project.shops.reduce((total, shop) => total + shop.roles.length, 0);

  return <details data-testid="payroll-rates-disclosure" className="group/payroll-rates border-t border-[#e5e1d7]">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-[#f7f6f0] px-4 py-2.5 text-[10px] font-bold text-[#53685a] hover:bg-[#f1f2e9]">
      <span className="flex items-center gap-2">
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 transition-transform group-open/payroll-rates:rotate-180" />
        ФОТ по цехам и профессиям
        <span className="font-normal text-[#85877e]">{roleCount} профессий · ₸/чел. в месяц</span>
      </span>
      <span className="text-[9px] font-medium text-[#777b76]">Изменить ставки</span>
    </summary>
    <div className="divide-y divide-[#eee9df]">
      <p className="px-4 py-2 text-[9px] leading-relaxed text-[#777b76]">
        Ставка вводится на одного человека до налогов работника. ФОТ профессии в месяц считается как ставка × количество людей; эти значения используются в расчётах проекта.
      </p>
      {project.shops.map(shop => {
        const includedRoleCount = shop.roles.filter(role => isRoleIncludedInCalculation(shop, role)).length;
        return <details key={shop.id} className="group/payroll-shop">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-white px-4 py-2 text-[10px] font-bold text-[#596461] hover:bg-[#faf9f5]">
            <span className="flex items-center gap-2">
              <ChevronDown aria-hidden="true" className="h-3 w-3 transition-transform group-open/payroll-shop:rotate-180" />
              {shop.name}
              <span className="font-normal text-[#85877e]">{includedRoleCount}/{shop.roles.length} профессий в расчёте</span>
            </span>
            {!shop.roles.length && <span className="font-normal text-[#99998f]">Нет профессий</span>}
          </summary>
          {shop.roles.length > 0 && <div className="divide-y divide-[#f0ede5]">
            {shop.roles.map(role => {
              const included = isRoleIncludedInCalculation(shop, role);
              const headcount = role.headcount ?? 1;
              const totalMonthly = role.monthlyPayrollKzt === undefined
                ? null
                : role.monthlyPayrollKzt * headcount;
              return <div key={role.id} className={`grid grid-cols-[minmax(100px,1fr)_minmax(130px,190px)_minmax(120px,180px)] items-center gap-3 px-4 py-2 ${included ? '' : 'bg-[#f7f6f2] text-[#94958d]'}`}>
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-semibold" title={role.name}>{role.name}</div>
                  <div className="mt-0.5 text-[9px]">{headcount} чел.{!included && ' · исключена из расчёта'}</div>
                </div>
                <label className="flex min-w-0 flex-col gap-0.5 text-[8px] text-[#737a77]">
                  Ставка, ₸/чел./мес.
                  <input
                    aria-label={`ФОТ за месяц: ${shop.name}, ${role.name}, тенге на человека`}
                    data-testid={`payroll-rate-${shop.id}-${role.id}`}
                    type="number"
                    min="0"
                    step="1"
                    placeholder="Не указана"
                    value={role.monthlyPayrollKzt ?? ''}
                    onChange={event => onRateChange(
                      shop.id,
                      role.id,
                      event.target.value === '' ? undefined : Math.max(0, Number(event.target.value) || 0),
                    )}
                    className="h-8 w-full rounded border border-[#ded9ce] bg-white px-2 text-[10px] font-medium text-[#303c39] outline-none focus:border-[#bd4c2b] focus:ring-1 focus:ring-[#bd4c2b]/20"
                  />
                </label>
                <div className="text-right">
                  <div className="text-[8px] text-[#737a77]">ФОТ профессии в месяц</div>
                  <div className="mt-0.5 text-[10px] font-bold tabular-nums text-[#416350]">
                    {totalMonthly === null ? 'Не указано' : `${formatKzt(totalMonthly)}/мес.`}
                  </div>
                </div>
              </div>;
            })}
          </div>}
        </details>;
      })}
    </div>
  </details>;
}
