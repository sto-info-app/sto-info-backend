/** Top-level SNS HTTP notification envelope */
export interface SnsEnvelope {
  Type: 'SubscriptionConfirmation' | 'Notification' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  /** Present only for SubscriptionConfirmation */
  SubscribeURL?: string;
  /** Present only for Notification — JSON-encoded SesNotification string */
  Message?: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
}

/** Shape of the JSON parsed from SnsEnvelope.Message for Notification type */
export interface SesNotification {
  notificationType: 'Bounce' | 'Complaint' | 'Delivery' | 'Reject';
  mail: SesMail;
  bounce?: SesBounce;
  complaint?: SesComplaint;
  delivery?: SesDelivery;
  reject?: SesReject;
}

export interface SesMail {
  messageId: string;
  source: string;
  destination: string[];
  timestamp: string;
}

export interface SesBounce {
  bounceType: 'Permanent' | 'Transient' | 'Undetermined';
  bounceSubType: string;
  bouncedRecipients: SesRecipient[];
  timestamp: string;
  feedbackId: string;
}

export interface SesComplaint {
  complainedRecipients: SesRecipient[];
  complaintFeedbackType?: string;
  timestamp: string;
  feedbackId: string;
}

export interface SesDelivery {
  recipients: string[];
  timestamp: string;
  processingTimeMillis: number;
  smtpResponse: string;
}

export interface SesRecipient {
  emailAddress: string;
  status?: string;
  action?: string;
  diagnosticCode?: string;
}
export interface SesReject {
  reason: string;
}
