# 汉语 к FIC

Офлайн-учебник китайского к выставке FIC. Статичное веб-приложение (PWA) без сборки.

- `index.html`, `style.css`, `app.js` — приложение
- `data.js` — уроки и слова (редактировать здесь)
- `sw.js` — офлайн-кэш; при изменении файлов увеличить `VERSION`
- Озвучка: встроенный голос iPhone (Web Speech API, zh-CN), работает без сети
- Прогресс: localStorage на устройстве

Запуск локально: `python3 -m http.server`

## Telegram

- Кнопка запуска: в @BotFather → бот → Bot Settings → Menu Button → URL `https://oxpamurday-oss.github.io/chinatutor/`.
- Напоминания: `.github/workflows/remind.yml` каждый день в 09:00 МСК шлёт сообщение с кнопкой «Открыть учебник».
  Нужны секреты репозитория `TELEGRAM_TOKEN` и `TELEGRAM_CHAT_ID`; дата выставки в переменной `FIC_DATE` (по умолчанию 2027-03-15).
