// AWS deployment module exports
export { selectAWSDeploymentTarget, getEBSolutionStack, isEBSupported, detectLanguage, type AWSTarget, type DeploymentAnalysis } from './awsDeploymentSelector';
export { setupAWSCredentials, runAWSCommand, ensureS3Bucket, uploadToS3, createZipBundle, getDefaultVpcId, getSubnetIds, ensureSecurityGroup, generateResourceName, waitForResource } from './awsHelpers';
export { handleAmplify } from './handleAmplify';
export { handleElasticBeanstalk } from './handleElasticBeanstalk';
export { handleECS } from './handleECS';
export { handleEC2 } from './handleEC2';
export { createRDSInstance, deleteRDSInstance } from './handleRDS';
