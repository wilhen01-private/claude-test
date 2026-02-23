import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MainStack } from '../src/stacks/main-stack';

describe('MainStack', () => {
  let app: cdk.App;
  let stack: MainStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new MainStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  describe('VPC', () => {
    it('creates a VPC with public and private subnets', () => {
      template.hasResourceProperties('AWS::EC2::VPC', {
        EnableDnsHostnames: true,
        EnableDnsSupport: true,
      });
    });

    it('creates exactly one NAT gateway', () => {
      template.resourceCountIs('AWS::EC2::NatGateway', 1);
    });

    it('creates 4 subnets (2 public, 2 private across 2 AZs)', () => {
      template.resourceCountIs('AWS::EC2::Subnet', 4);
    });

    it('creates an internet gateway', () => {
      template.resourceCountIs('AWS::EC2::InternetGateway', 1);
    });
  });

  describe('ECS Cluster', () => {
    it('creates an ECS cluster with container insights enabled', () => {
      template.hasResourceProperties('AWS::ECS::Cluster', {
        ClusterSettings: Match.arrayWith([
          Match.objectLike({
            Name: 'containerInsights',
            Value: 'enabled',
          }),
        ]),
      });
    });
  });

  describe('Fargate Task Definition', () => {
    it('creates a Fargate task definition with default CPU and memory', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        Cpu: '256',
        Memory: '512',
        NetworkMode: 'awsvpc',
        RequiresCompatibilities: ['FARGATE'],
      });
    });

    it('defines a container with port 80 mapping', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            PortMappings: [{ ContainerPort: 80, Protocol: 'tcp' }],
          }),
        ]),
      });
    });

    it('configures the container to use nginx image by default', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            Image: 'nginx:latest',
          }),
        ]),
      });
    });

    it('configures awslogs log driver', () => {
      template.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({
            LogConfiguration: {
              LogDriver: 'awslogs',
              Options: Match.objectLike({
                'awslogs-stream-prefix': 'app',
              }),
            },
          }),
        ]),
      });
    });

    it('creates an execution role for the task', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'ecs-tasks.amazonaws.com' },
            }),
          ]),
        }),
      });
    });
  });

  describe('Fargate Service', () => {
    it('creates a Fargate service with desired count of 2', () => {
      template.hasResourceProperties('AWS::ECS::Service', {
        DesiredCount: 2,
        LaunchType: 'FARGATE',
      });
    });

    it('places tasks in private subnets', () => {
      template.hasResourceProperties('AWS::ECS::Service', {
        NetworkConfiguration: {
          AwsvpcConfiguration: {
            AssignPublicIp: 'DISABLED',
          },
        },
      });
    });
  });

  describe('Application Load Balancer', () => {
    it('creates a public Application Load Balancer', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
        Scheme: 'internet-facing',
        Type: 'application',
      });
    });

    it('creates an HTTP listener on port 80', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
        Port: 80,
        Protocol: 'HTTP',
      });
    });

    it('creates a target group with health check on /', () => {
      template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
        HealthCheckPath: '/',
        Matcher: { HttpCode: '200' },
        TargetType: 'ip',
      });
    });
  });

  describe('SNS Topic', () => {
    it('creates an SNS input topic', () => {
      template.resourceCountIs('AWS::SNS::Topic', 1);
    });

    it('sets a display name on the topic', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        DisplayName: 'Fargate Application Input Topic',
      });
    });

    it('subscribes the SQS queue to the SNS topic', () => {
      template.resourceCountIs('AWS::SNS::Subscription', 1);
      template.hasResourceProperties('AWS::SNS::Subscription', {
        Protocol: 'sqs',
      });
    });

    it('outputs the SNS topic ARN', () => {
      template.hasOutput('InputTopicArn', {
        Description: 'ARN of the SNS input topic',
      });
    });
  });

  describe('SQS Queue', () => {
    it('creates an input queue and a dead-letter queue', () => {
      template.resourceCountIs('AWS::SQS::Queue', 2);
    });

    it('configures the input queue with a dead-letter queue', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 3,
        }),
      });
    });

    it('enforces SSL on both queues', () => {
      template.resourceCountIs('AWS::SQS::QueuePolicy', 2);
    });

    it('passes the queue URL and topic ARN to the container as environment variables', () => {
      const resources = template.findResources('AWS::ECS::TaskDefinition');
      const taskDef = Object.values(resources)[0] as any;
      const envVars: Array<{ Name: string }> =
        taskDef.Properties.ContainerDefinitions[0].Environment;
      expect(envVars).toBeDefined();
      const envNames = envVars.map((e) => e.Name);
      expect(envNames).toContain('SQS_QUEUE_URL');
      expect(envNames).toContain('SNS_TOPIC_ARN');
    });

    it('grants the task role consume permissions on the input queue', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'sqs:ReceiveMessage',
                'sqs:ChangeMessageVisibility',
                'sqs:GetQueueUrl',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
              ]),
            }),
          ]),
        }),
      });
    });
  });

  describe('CloudWatch Logs', () => {
    it('creates a log group with 30-day retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        RetentionInDays: 30,
      });
    });
  });

  describe('Outputs', () => {
    it('outputs the load balancer DNS name', () => {
      template.hasOutput('LoadBalancerDns', {
        Description: 'DNS name of the Application Load Balancer',
      });
    });
  });

  describe('Custom props', () => {
    it('accepts custom CPU and memory settings', () => {
      const customApp = new cdk.App();
      const customStack = new MainStack(customApp, 'CustomStack', {
        cpu: 512,
        memoryLimitMiB: 1024,
        desiredCount: 3,
        containerImage: 'my-app:1.0.0',
      });
      const customTemplate = Template.fromStack(customStack);

      customTemplate.hasResourceProperties('AWS::ECS::TaskDefinition', {
        Cpu: '512',
        Memory: '1024',
      });

      customTemplate.hasResourceProperties('AWS::ECS::Service', {
        DesiredCount: 3,
      });

      customTemplate.hasResourceProperties('AWS::ECS::TaskDefinition', {
        ContainerDefinitions: Match.arrayWith([
          Match.objectLike({ Image: 'my-app:1.0.0' }),
        ]),
      });
    });
  });
});
