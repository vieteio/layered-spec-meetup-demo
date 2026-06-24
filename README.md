# App development with layered-spec demo

This app was created with [**layered-spec**](https://github.com/vieteio/layered-spec): spec-programming skills, which makes AI development predictable.

The full app was built from 5 messages in a chat with an AI agent.

## App

The demo app is a construction drawing estimation service.

![Estimation results UI](assets/screenshot.png)

The screenshot shows a completed document detail page with parsed and estimation markdown rendered in the UI.

## Creation process

The planning and implementation trail is kept in this repo so you can review how the app was built:

- [`chats/`](chats/) — interactive session log with the AI agent
- [`specs/`](specs/) — workflow-bearing spec that drove implementation

## Runnable app

The service code lives in [`service/`](service/). See [`service/README.md`](service/README.md) for setup and API details.

```bash
cd service
cp .env.example .env
yarn install
yarn run db:push
yarn run dev
```
