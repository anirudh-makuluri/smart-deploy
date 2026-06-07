resource "aws_ecs_cluster" "this" {
  count = var.create_ecs_cluster ? 1 : 0
  name  = var.ecs_cluster_name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = var.ecs_cluster_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

data "aws_ecs_cluster" "existing" {
  count        = var.create_ecs_cluster ? 0 : 1
  cluster_name = var.ecs_cluster_name
}

resource "aws_cloudwatch_log_group" "ecs" {
  name              = var.ecs_log_group_name
  retention_in_days = var.ecs_log_retention_days

  tags = {
    Name        = var.ecs_log_group_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "ecs_execution" {
  name = var.ecs_execution_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "smartdeploy-ecs-secrets-read"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:smartdeploy/*"
    }]
  })
}
