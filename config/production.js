import envalid from 'envalid'
const { str, port, num } = envalid

const config = envalid.cleanEnv(process.env, {
    HOST: str(),
    PORT: port(),
    NOTIFY_URL: str(),
    NOTIFY_URL_DEV: str({default: 'localhost'}),
    FREEZE: num()
})
export default config;