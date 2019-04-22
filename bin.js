#!/usr/bin/env node

'use strict'

const os = require('os')
const path = require('path')
const fs = require('fs')

const TeleBot = require('telebot')
const bot = new TeleBot(process.argv[2])
const URI = require('urijs')

const ERROR_REPLY = 'Boom!\nYou just made this bot go kaboom!\nHave a :cookie:!'

const yaml = require('js-yaml')
const words = yaml.safeLoad(String(fs.readFileSync(path.join(__dirname, 'words.yaml'))))

const Sentry = require('@sentry/node')
Sentry.init({dsn: process.env.SENTRY_DSN})

const pino = require('pino')
const log = pino({name: 'tg-crypto-spam-bot'})

const origOn = bot.on.bind(bot)
bot.on = (ev, fnc, ...a) => {
  origOn(ev, async (msg, ...a) => {
    try {
      let res = await fnc(msg, ...a)
      return res
    } catch (e) {
      log.error(e)
      Sentry.captureException(e)
      try {
        msg.reply.text(ERROR_REPLY)
      } catch (e) {
        // ignore
      }
    }
  }, ...a)
}

bot.on(['/start', '/hello'], (msg) => msg.reply.text('This bot helps you to get rid of crypto spam in your group!', {webPreview: false}))

bot.start()
