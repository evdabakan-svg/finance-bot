require('dotenv').config()
const { Telegraf } = require('telegraf')
const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
})

const bot = new Telegraf(process.env.BOT_TOKEN)

function parseMessage(text) {
  const parts = text.trim().split(' ')
  
  const amountRaw = parts[0]
  const amount = parseFloat(amountRaw)

  if (isNaN(amount)) return null

  const type = amountRaw.startsWith('-')
    ? 'expense'
    : 'income'

  return {
    amount: Math.abs(amount),
    type,
    category: parts[1],
    comment: parts.slice(2).join(' ')
  }
}

async function getUser(ctx) {
  const tgId = ctx.from.id
  const name = ctx.from.username || ctx.from.first_name

  let user = await pool.query(
    'SELECT * FROM users WHERE telegram_id=$1',
    [tgId]
  )

  if (user.rows.length === 0) {
    user = await pool.query(
      'INSERT INTO users (telegram_id,name) VALUES ($1,$2) RETURNING *',
      [tgId, name]
    )
  }

  return user.rows[0]
}

bot.command('add_category', async (ctx) => {
  const parts = ctx.message.text.split(' ')

  const type = parts[1]
  const name = parts[2]

  const dbType =
    type === 'доход'
      ? 'income'
      : 'expense'

  await pool.query(
    'INSERT INTO categories (name,type) VALUES ($1,$2)',
    [name, dbType]
  )

  ctx.reply('✅ Категория добавлена')
})

bot.command('last', async (ctx) => {
  const res = await pool.query(`
    SELECT t.id, t.amount, t.type, c.name
    FROM transactions t
    JOIN categories c ON c.id=t.category_id
    ORDER BY t.id DESC
    LIMIT 5
  `)

  if (res.rows.length === 0) {
    return ctx.reply('Нет записей')
  }

  const text = res.rows.map(r =>
    `${r.id}: ${r.type === 'expense' ? '-' : '+'}${r.amount} ${r.name}`
  ).join('\\n')

  ctx.reply(text)
})

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return

  const parsed = parseMessage(ctx.message.text)

  if (!parsed) {
    return ctx.reply('❌ Неверный формат')
  }

  const user = await getUser(ctx)

  const cat = await pool.query(
    'SELECT * FROM categories WHERE name=$1 AND type=$2',
    [parsed.category, parsed.type]
  )

  if (cat.rows.length === 0) {
    return ctx.reply('❌ Категория не найдена')
  }

  const category = cat.rows[0]

  await pool.query(`
    INSERT INTO transactions
    (user_id,amount,type,category_id,comment)
    VALUES ($1,$2,$3,$4,$5)
  `, [
    user.id,
    parsed.amount,
    parsed.type,
    category.id,
    parsed.comment
  ])

  ctx.reply('✅ Сохранено')
})

bot.launch()
console.log('Bot started')
