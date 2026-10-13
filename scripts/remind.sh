#!/usr/bin/env bash
# Daily reminder to the Telegram bot chat. Needs TELEGRAM_TOKEN and TELEGRAM_CHAT_ID secrets.
set -euo pipefail
APP_URL="https://oxpamurday-oss.github.io/chinatutor/"
FIC_DATE="${FIC_DATE:-2027-03-15}"
days=$(( ( $(date -d "$FIC_DATE" +%s) - $(date -d "$(date +%F)" +%s) ) / 86400 ))
if [ "$(date +%u)" = "1" ]; then
  text="Новая неделя: пройдите следующий урок в учебнике. До FIC осталось ${days} дн."
else
  text="Пора повторить карточки, это 10 минут. До FIC осталось ${days} дн."
fi
markup=$(printf '{"inline_keyboard":[[{"text":"Открыть учебник","web_app":{"url":"%s"}}]]}' "$APP_URL")
curl -sS --fail -X POST "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${text}" \
  --data-urlencode "reply_markup=${markup}" > /dev/null
echo "sent: ${text}"
