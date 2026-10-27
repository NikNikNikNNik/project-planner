---
name: ResizeObserver и runtime overlay
description: Обработка ошибочного runtime-падения при цикле ResizeObserver в preview.
---

В preview браузерное сообщение `ResizeObserver loop completed with undelivered notifications` может отображаться как общая runtime-ошибка, хотя стек приложения отсутствует и backend продолжает отвечать.

**Why:** React state update непосредственно в callback ResizeObserver может менять layout в том же цикле доставки наблюдателя и вызывать это сообщение.

**How to apply:** проверять browser console отдельно от API и workflow логов; откладывать применение измеренной ширины до `requestAnimationFrame`, игнорировать одинаковые размеры и отменять ожидающий кадр при размонтировании. Не подавлять все глобальные ошибки ради сокрытия этого сообщения.
