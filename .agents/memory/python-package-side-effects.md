---
name: Python package install side effects
description: Temporary Python package installation in the PNPM workspace can alter Replit configuration and create root-level Python project files.
---

При установке Python-пакета в PNPM-монорепо менеджер пакетов может добавить Python-модуль в `.replit` и создать корневые `pyproject.toml`, `uv.lock` и `src/`, даже если Python не является частью приложения.

**Why:** Одноразовая установка парсера XLSB неожиданно затронула конфигурацию запуска и структуру проекта.

**How to apply:** После временной установки проверьте изменения `.replit` и корневые Python-файлы. Если Python не нужен приложению, удалите созданные манифесты и восстановите исходную конфигурацию `.replit` через платформенный валидатор.
