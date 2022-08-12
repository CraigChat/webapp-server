# Craig Webapp Server

This is the server for the [Craig Webapp](https://github.com/CraigChat/webapp), allowing for Discord bot shards to connect to it and accept connections and data.

Copy the `.env.example` file to `.env`, only the `SHARD_AUTH` environment variable is really needed for shard connections to be accepted.

You can run `yarn start` to start the server and run `yarn start:test-client` to create a client that will be connected with the ID and key as "test". You can put this into a PM2 instance with `pm2 start`.

You can also run this in a Docker container:
```
docker run --name webapp-server -e SHARD_AUTH=XXXXXX -d ghcr.io/craigchat/webapp-server:latest
```

Alternatively, you can use Docker compose and run `docker-compose up -d` to start the container if you have pulled the repository locally.