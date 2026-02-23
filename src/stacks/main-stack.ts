import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface MainStackProps extends cdk.StackProps {
  containerImage?: string;
  cpu?: number;
  memoryLimitMiB?: number;
  desiredCount?: number;
}

export class MainStack extends cdk.Stack {
  public readonly service: ecs_patterns.ApplicationLoadBalancedFargateService;
  public readonly cluster: ecs.Cluster;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: MainStackProps = {}) {
    super(scope, id, props);

    const {
      containerImage = 'nginx:latest',
      cpu = 256,
      memoryLimitMiB = 512,
      desiredCount = 2,
    } = props;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: this.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    const logGroup = new logs.LogGroup(this, 'ServiceLogGroup', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      cpu,
      memoryLimitMiB,
    });

    taskDefinition.addContainer('AppContainer', {
      image: ecs.ContainerImage.fromRegistry(containerImage),
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: 'app',
      }),
    });

    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      'FargateService',
      {
        cluster: this.cluster,
        taskDefinition,
        desiredCount,
        publicLoadBalancer: true,
        assignPublicIp: false,
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      },
    );

    this.service.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDns', {
      value: this.service.loadBalancer.loadBalancerDnsName,
      description: 'DNS name of the Application Load Balancer',
    });
  }
}
