import axios from 'axios';

/**
 * How a sign-in code reaches the customer. The rest of the app only knows `OtpSender`, so WhatsApp can be switched on (or replaced
 * by SMS) without touching the login flow.
 *   OTP_SENDER=console   (default) prints the code in the server log. Never allowed in production.
 *   OTP_SENDER=whatsapp  WhatsApp Cloud API (Meta). Needs WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_OTP_TEMPLATE
 *                        (an approved "authentication" template; WHATSAPP_OTP_LANG, default fr).
 */
export interface OtpSender {
  channel: 'console' | 'whatsapp';
  /** `phone` is canonical (`+221 771234567`). Throws when the message could not be handed to the provider. */
  send(phone: string, code: string): Promise<void>;
}

const maskPhone = (phone: string) => phone.replace(/\d(?=\d{3})/g, '*');

export const consoleSender: OtpSender = {
  channel: 'console',
  async send(phone, code) {
    console.log(`[otp] code for ${maskPhone(phone)}: ${code}`);
  },
};

export const whatsappSender = (): OtpSender => {
  const token = process.env.WHATSAPP_TOKEN || '';
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const template = process.env.WHATSAPP_OTP_TEMPLATE || '';
  const lang = process.env.WHATSAPP_OTP_LANG || 'fr';
  return {
    channel: 'whatsapp',
    async send(phone, code) {
      // Authentication template: the code goes in the body and in the "copy code" button.
      await axios.post(
        `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: phone.replace(/\D/g, ''),
          type: 'template',
          template: {
            name: template,
            language: { code: lang },
            components: [
              { type: 'body', parameters: [{ type: 'text', text: code }] },
              { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
            ],
          },
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 10_000 },
      );
    },
  };
};

export const whatsappConfigured = (): boolean =>
  !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_OTP_TEMPLATE);

let injected: OtpSender | null = null;
/** Tests: replace the sender (null goes back to the configured one). */
export const setOtpSender = (s: OtpSender | null) => { injected = s; };

/** The sender in use, or null when none is allowed (console sender in production, or WhatsApp asked for without its settings). */
export const getOtpSender = (): OtpSender | null => {
  if (injected) return injected;
  if (process.env.OTP_SENDER === 'whatsapp') return whatsappConfigured() ? whatsappSender() : null;
  return process.env.NODE_ENV === 'production' ? null : consoleSender;
};
