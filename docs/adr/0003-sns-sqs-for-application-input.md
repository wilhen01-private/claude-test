# 3. Use SNS → SQS for Application Input

Date: 2026-02-23

## Status

Accepted

## Context

The Fargate application needs to receive event-driven input from other systems.
We considered three delivery mechanisms:

- **Direct HTTP via the ALB** — producers call the ALB endpoint synchronously;
  the application processes the request inline and returns a response.
- **SNS with HTTP/HTTPS subscription** — SNS delivers messages directly to the
  ALB URL; the application must respond within the SNS delivery timeout.
- **SNS fanout to an SQS queue** — producers publish to a topic; the queue
  buffers messages; the application polls the queue at its own pace.

Direct HTTP couples producers to the availability of the Fargate service: if all
tasks are busy or a deployment is in progress, producers receive errors and must
implement their own retry logic. SNS direct delivery has the same coupling problem
and adds SNS's 23-second delivery timeout as a hard constraint on processing time.

Buffering through SQS decouples the intake rate from the processing rate and
provides at-least-once delivery with configurable retry behaviour.

## Decision

We will use an **SNS topic (`InputTopic`) with an SQS subscription (`InputQueue`)**
as the application's input channel.

- Producers publish to `InputTopic`. The topic ARN is exported as a CloudFormation
  output and injected into the container as `SNS_TOPIC_ARN`.
- SNS delivers all published messages to `InputQueue`.
- The Fargate task polls `InputQueue` using `SQS_QUEUE_URL` (also injected as an
  environment variable) and processes messages at its own pace.
- The queue has a **visibility timeout of 300 seconds** to give tasks sufficient
  time to process a message before it becomes visible again.
- After **3 failed receive attempts** the message is moved to `InputDLQ`, where
  it is retained for 14 days for inspection and replay.
- The Fargate task role is granted `sqs:ReceiveMessage`, `sqs:DeleteMessage`,
  `sqs:ChangeMessageVisibility`, `sqs:GetQueueAttributes`, and `sqs:GetQueueUrl`
  on `InputQueue` only; it has no direct publish permissions on the topic.
- Both queues enforce SSL (`enforceSSL: true`), rejecting unencrypted connections.

The SNS topic is retained as the stable public interface. Adding future consumers
(e.g. a Lambda for alerting, a Firehose for archival) requires only a new
subscription on `InputTopic` and no changes to existing producers or to the
Fargate application.

## Consequences

- Processing is **asynchronous**; producers receive a `MessageId` from SNS but no
  application-level acknowledgement. Workflows that require a synchronous response
  must use the ALB endpoint instead.
- The DLQ provides a safety net for poison-pill messages, but operations must
  monitor the DLQ depth and have a runbook for replaying or discarding messages.
- Queue depth can be used as a scaling metric for the Fargate service
  (Application Auto Scaling on `ApproximateNumberOfMessagesVisible`), though this
  is not wired up in the initial implementation.
- Message order is **not guaranteed**; SNS-to-SQS delivery is a standard (not
  FIFO) queue. Applications that require strict ordering must migrate to an
  SNS FIFO topic with an SQS FIFO queue.
- The additional SQS `ReceiveMessage` poll loop adds a small latency (typically
  < 1 second with long polling) between a producer publishing and the application
  beginning to process.
