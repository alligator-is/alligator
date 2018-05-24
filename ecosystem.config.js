module.exports = {

  apps : [

    // First application
    {
      name      : 'alligator',
      script    : './bin.js',
      args:'start --config.listen "shs+tcp://[::]:81" --config.listen "shs+ws://[::]:80" --config.logLevel 6',
      env: {
      },
      env_production : {
        NODE_ENV: 'production'
      }
    }
  ]
};
