# 2. Use AWS Fargate for Container Compute

Date: 2026-02-23

## Status

Accepted

## Context

The application is packaged as a container image. We need to choose how to run
that image in production. The primary options were:

- **EC2 with ECS** — containers scheduled onto self-managed EC2 instances
- **AWS Fargate** — serverless container runtime; no EC2 instances to manage
- **AWS Lambda (container image)** — event-driven, billed per invocation, 15-minute
  execution limit
- **EKS (Kubernetes)** — full Kubernetes control plane, higher operational overhead

The team wants to avoid managing the underlying host fleet (patching, capacity
planning, draining nodes for updates). Lambda's invocation model and time limit
make it unsuitable for a long-running service that holds connections and maintains
in-process state. EKS is appropriate at larger scale but introduces significant
operational overhead for a single service.

## Decision

We will run the application on **AWS Fargate** via `ecs_patterns.ApplicationLoadBalancedFargateService`.

Tasks are placed in **private subnets** with egress through a single NAT gateway;
the ALB sits in public subnets and terminates inbound traffic. Container Insights
is enabled on the cluster for task-level CPU and memory metrics without additional
instrumentation. The CDK L3 pattern wires the ALB, target group, listener, and
security groups together with secure defaults.

## Consequences

- No EC2 instances to patch, right-size, or drain; the blast radius of a host
  failure is limited to individual tasks.
- Task startup is slower than a pre-warmed EC2 instance; the service is not suited
  to bursty workloads that require sub-second scale-out.
- CPU and memory are fixed per task definition; workloads with variable resource
  needs require a new deployment to resize rather than live resizing.
- Fargate per-vCPU and per-GB pricing is higher than equivalent reserved EC2
  capacity; this trade-off favours operational simplicity over cost optimisation at
  current scale.
- Tasks run in private subnets, so outbound internet access depends on the NAT
  gateway; losing the NAT gateway isolates all tasks from external endpoints.
