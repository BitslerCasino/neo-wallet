module.exports = {
  "apps" : [{
    "name": "neo-wallet",
      "script": "main.js",
      "exec_mode": "fork",
      "instances": 1,
      "autorestart": true,
      "watch": false,
      "max_memory_restart": "2G",
      "log_date_format": "YYYY-MM-DDTHH:mm:ssZ",
      "node_args": "-r esm -r dotenv/config",
      "args": "--color",
      "time": true
  }]
};
