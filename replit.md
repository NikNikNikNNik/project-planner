# Планировщик проектов

Русскоязычный планировщик сроков проектов и подготовки персонала по четырём производственным цехам.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — запуск API
- `pnpm --filter @workspace/project-planner run dev` — запуск веб-приложения
- `pnpm run typecheck` — проверка типов workspace
- `pnpm --filter @workspace/api-spec run codegen` — генерация клиентских хуков и схем из OpenAPI
- `pnpm --filter @workspace/db run push` — применение схемы к базе разработки
- Требуется `DATABASE_URL` для PostgreSQL.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Где находится код

- `artifacts/project-planner/` — React-интерфейс доски и портфеля проектов.
- `artifacts/api-server/src/routes/projects.ts` — REST API проектов.
- `lib/api-spec/openapi.yaml` — контракт API; после изменения запускайте codegen.
- `lib/db/src/schema/projects.ts` — таблица проектов.

## Архитектурные решения

- План проекта хранится как структурированный JSON в PostgreSQL вместе с основной записью проекта, чтобы автосохранение отправляло согласованный снимок.
- Даты планирования — календарные значения `YYYY-MM-DD`; не преобразовывать их в моменты времени и не применять часовой сдвиг.
- OpenAPI — источник истины для API-контракта и сгенерированных типов/хуков.
- Подготовка персонала рассчитывается на клиенте из длительностей мероприятий; введённая вручную дата контракта имеет приоритет и проверяется на дефицит времени.

## Product

Пользователь ведёт отдельные проекты для площадок «Пиролиз», «Бутен1», «Полимеризация» и «ОЗХ», настраивает роли, этапы «Стройка», «ПредПНР», «ПНР», «Эксплуатация», контрольные отсечки MC/RFSU и обучение. Даты готовности и контракта пересчитываются по режиму обучения и настройке календарных/рабочих дней. Проекты сохраняются в PostgreSQL.

## Требования к продукту

- Интерфейс и тексты приложения — на русском языке.
- MVP рассчитан на одного пользователя; совместная работа и права доступа остаются на будущее.

## Важные замечания

- В OpenAPI не задавайте `format: date` для календарных полей: генератор Zod может преобразовать их в объекты `Date`, что приводит к временным меткам и ломает календарные поля интерфейса.
- При изменении `lib/api-spec/openapi.yaml` перезапустите codegen до проверки зависимых пакетов.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
