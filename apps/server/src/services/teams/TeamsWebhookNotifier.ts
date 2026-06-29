const MAX_BODY_LEN = 18_000;

export function buildAgentCard(
  agentName: string,
  status: 'done' | 'failed',
  body: string,
): object {
  const isDone = status === 'done';
  const titleText = `${isDone ? '✅' : '❌'} ${agentName} — ${isDone ? 'completed' : 'failed'}`;

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
            {
              type: 'TextBlock',
              weight: 'Bolder',
              size: 'Medium',
              text: titleText,
            },
            {
              type: 'TextBlock',
              wrap: true,
              text: bodyText,
            },
          ],
        },
      },
    ],
  };
}

export class TeamsWebhookNotifier {
  constructor(private url: string) {}

  async postResult(
    agentName: string,
    status: 'done' | 'failed',
    body: string,
  ): Promise<void> {
    const card = buildAgentCard(agentName, status, body);
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify(card),
    });
    if (!res.ok) {
      throw new Error(`TeamsWebhookNotifier: POST failed with status ${res.status}`);
    }
  }
}
