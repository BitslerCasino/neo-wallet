import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

const adapter = new FileSync('db.json')
const db = low(adapter)

db.defaults({ settings: {} }).write()

export const setSettings = function(key, val) {
  db.set(`settings.${key}`, val)
    .write()
}
export const getSettings = function(key) {
  return db.get(`settings.${key}`).value()
}