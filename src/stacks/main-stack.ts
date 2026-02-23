import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Add your AWS resources here
  }
}
