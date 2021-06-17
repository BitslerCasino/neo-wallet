module.exports = {
  "apps": [{
    "name": "neo-wallet",
    "script": "main.js",
    "exec_mode": "fork",
    "autorestart": true,
    "watch": false,
    "max_memory_restart": "2G",
    "log_date_format": "YYYY-MM-DDTHH:mm:ssZ",
    "node_args": "-r esm -r dotenv/config",
    "args": "--color",
    "time": true
  }, {
    "name": "neo-provider-updater",
    "script": "./src/updateProviders.js",
    "exec_mode": "fork",
    "autorestart": true,
    "env": {
      "RESTART": "15"
    },
    "max_memory_restart": "1G",
    "log_date_format": "YYYY-MM-DDTHH:mm:ssZ",
    "node_args": "-r esm",
    "time": true
  }]
};
