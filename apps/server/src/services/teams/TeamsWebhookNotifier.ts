const MAX_BODY_LEN = 18_000;

/** Shared Adaptive-Card envelope builder: a bold title block + a wrapping body block. */
function buildCard(titleText: string, body: string): object {
  let bodyText = body;
  if (bodyText.length > MAX_BODY_LEN) {
    bodyText = bodyText.slice(0, MAX_BODY_LEN) + '\n\n…(truncated)';
  }
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.4',
          body: [
            { type: 'TextBlock', weight: 'Bolder', size: 'Medium', text: titleText },
            { type: 'TextBlock', wrap: true, text: bodyText },
          ],
        },
      },
    ],
  };
}

export function buildAgentCard(
  agentName: string,
  status: 'done' | 'failed',
  body: string,
): object {
  const isDone = status === 'done';
  return buildCard(`${isDone ? '✅' : '❌'} ${agentName} — ${isDone ? 'completed' : 'failed'}`, body);
}

export class TeamsWebhookNotifier {
  constructor(private url: string) {}

  /** Post a pre-built Adaptive Card. Throws on a non-2xx response. */
  async postCard(card: object): Promise<void> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      throw new Error(`TeamsWebhookNotifier: POST failed with status ${res.status}`);
    }
  }

  async postResult(
    agentName: string,
    status: 'done' | 'failed',
    body: string,
  ): Promise<void> {
    await this.postCard(buildAgentCard(agentName, status, body));
  }
}
