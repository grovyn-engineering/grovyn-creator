module.exports = {
  apps: [
    {
      name: "socialpilot-backend-api",
      cwd: "./backend",
      script: "dist/server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_production: {
        NODE_ENV: "production",
      },
    },
    {
      name: "socialpilot-backend-worker",
      cwd: "./backend",
      script: "dist/worker.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env_production: {
        NODE_ENV: "production",
      },
    },
    {
      name: "socialpilot-frontend",
      cwd: "./frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3000",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
