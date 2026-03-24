import { config } from '../config/index.js';

export interface SmsOptions {
  to: string;
  body: string;
}

/**
 * Generic SMS gateway adapter.
 * Sends SMS via HTTP POST to a configurable gateway URL.
 * Adapt the request body format to match your SMS provider.
 */
export async function sendSms(options: SmsOptions): Promise<void> {
  if (!config.SMS_GATEWAY_URL || !config.SMS_GATEWAY_API_KEY) {
    console.warn('SMS gateway not configured, skipping SMS send');
    return;
  }

  const response = await fetch(config.SMS_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.SMS_GATEWAY_API_KEY}`,
    },
    body: JSON.stringify({
      sender: config.SMS_SENDER || 'IT_DESTEK',
      to: options.to,
      message: options.body,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SMS gateway error: ${response.status} - ${text}`);
  }
}
