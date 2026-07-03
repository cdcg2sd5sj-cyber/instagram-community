# Reels Boost — Telegram Mini App

## Быстрый старт

### 1. Клонируй и установи зависимости
```bash
cd backend && npm install
```

### 2. Настрой переменные окружения
```bash
cp .env.example .env
# Заполни все значения в .env
```

### 3. Создай базу данных
```bash
npx prisma migrate dev --name init
npx prisma generate
```

### 4. Залей стартовые данные
```bash
npx ts-node prisma/seed.ts
```

### 5. Запусти сервер
```bash
npm run start:dev
```

---

## Что нужно получить

| Сервис | Где взять |
|--------|-----------|
| Telegram Bot Token | @BotFather в Telegram |
| RapidAPI Key | rapidapi.com → Instagram Scraper API |
| Anthropic API Key | console.anthropic.com |
| PostgreSQL | Railway / Supabase (бесплатно) |

---

## Структура проекта

```
reels-boost/
├── prisma/
│   ├── schema.prisma     — схема БД
│   └── seed.ts           — стартовые данные
├── backend/
│   └── src/
│       ├── auth/         — Telegram авторизация
│       ├── users/        — пользователи
│       ├── campaigns/    — кампании продвижения
│       ├── tasks/        — задания + ИИ проверка
│       └── prisma/       — сервис БД
└── frontend/             — Next.js (следующий шаг)
```

---

## Экономика Credits

- Новый пользователь получает: **10 ₢**
- За выполнение задания: **+15 ₢**
- Стоимость 1 участника: **1.5 ₢**
- Пример: 20 участников = 30 ₢

---

## Алгоритм очереди заданий

Система показывает задание с наименьшим количеством выполнений.
Одно задание — одно выполнение на пользователя (UNIQUE constraint в БД).
Собственные кампании пользователя не показываются ему в ленте.
