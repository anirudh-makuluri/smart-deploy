resource "aws_sqs_queue" "deployment_runs_dlq" {
  count = var.enable_deployment_queue ? 1 : 0

  name                        = local.deployment_queue_dlq_name
  fifo_queue                  = true
  content_based_deduplication = false
  sqs_managed_sse_enabled     = true

  tags = {
    Name        = local.deployment_queue_dlq_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

resource "aws_sqs_queue" "deployment_runs" {
  count = var.enable_deployment_queue ? 1 : 0

  name                        = local.deployment_queue_name
  fifo_queue                  = true
  content_based_deduplication = false
  visibility_timeout_seconds  = var.deployment_queue_visibility_timeout_seconds
  sqs_managed_sse_enabled     = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.deployment_runs_dlq[0].arn
    maxReceiveCount     = var.deployment_queue_max_receive_count
  })

  tags = {
    Name        = local.deployment_queue_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

resource "aws_iam_role" "deployment_queue_lambda" {
  count = var.enable_deployment_queue ? 1 : 0

  name = "${local.deployment_queue_lambda_function_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
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

resource "aws_iam_role_policy_attachment" "deployment_queue_lambda_basic" {
  count = var.enable_deployment_queue ? 1 : 0

  role       = aws_iam_role.deployment_queue_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "deployment_queue_lambda_sqs" {
  count = var.enable_deployment_queue ? 1 : 0

  role       = aws_iam_role.deployment_queue_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
}

resource "aws_iam_role_policy" "deployment_queue_lambda_ecs" {
  count = var.enable_deployment_queue ? 1 : 0

  name = "${local.deployment_queue_lambda_function_name}-ecs"
  role = aws_iam_role.deployment_queue_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ecs:RunTask",
          "ecs:TagResource"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "iam:PassRole"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "deployment_worker_task" {
  count = var.enable_deployment_queue ? 1 : 0

  name = local.deployment_worker_task_role_name

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

resource "aws_iam_role_policy" "deployment_worker_task" {
  count = var.enable_deployment_queue ? 1 : 0

  name = "${local.name_prefix}-deployment-worker-task"
  role = aws_iam_role.deployment_worker_task[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "acm:DescribeCertificate",
          "cloudfront:CreateInvalidation",
          "codebuild:*",
          "dynamodb:*",
          "ec2:*",
          "ecr:*",
          "ecs:*",
          "elasticloadbalancing:*",
          "iam:*",
          "logs:*",
          "route53:*",
          "s3:*",
          "secretsmanager:*",
          "ssm:*",
          "sts:GetCallerIdentity"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_ecs_task_definition" "deployment_worker" {
  count = var.enable_deployment_queue ? 1 : 0

  family                   = "${local.name_prefix}-deployment-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.deployment_worker_task_cpu
  memory                   = var.deployment_worker_task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.deployment_worker_task[0].arn

  container_definitions = jsonencode([
    {
      name      = var.deployment_worker_container_name
      image     = var.deployment_worker_image
      essential = true
      command   = ["node", "dist/deployment-runner.js"]
      environment = [
        { name = "AWS_REGION", value = var.aws_region },
        { name = "ECS_ASSIGN_PUBLIC_IP", value = local.deployment_worker_assign_public_ip },
        { name = "ECS_CLUSTER_NAME", value = local.deployment_worker_cluster_name },
        { name = "ECS_EXECUTION_ROLE_ARN", value = aws_iam_role.ecs_execution.arn },
        { name = "ECS_LOG_GROUP", value = aws_cloudwatch_log_group.ecs.name },
        { name = "ECS_SECURITY_GROUP_IDS", value = join(",", local.deployment_worker_security_group_ids) },
        { name = "ECS_SUBNET_IDS", value = join(",", local.deployment_worker_subnet_ids) },
        { name = "ECS_TASK_CPU", value = var.deployment_worker_task_cpu },
        { name = "ECS_TASK_MEMORY", value = var.deployment_worker_task_memory },
        { name = "AWS_SECRETS_ARN", value = var.deployment_worker_secret_arn },
        { name = "USE_CODEBUILD", value = "true" },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.ecs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "deployment-worker"
        }
      }
    }
  ])

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  tags = {
    Name        = "${local.name_prefix}-deployment-worker"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

resource "aws_cloudwatch_log_group" "deployment_queue_lambda" {
  count = var.enable_deployment_queue ? 1 : 0

  name              = "/aws/lambda/${local.deployment_queue_lambda_function_name}"
  retention_in_days = var.deployment_queue_lambda_log_retention_days

  tags = {
    Name        = "/aws/lambda/${local.deployment_queue_lambda_function_name}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

resource "aws_lambda_function" "deployment_queue" {
  count = var.enable_deployment_queue ? 1 : 0

  function_name = local.deployment_queue_lambda_function_name
  role          = aws_iam_role.deployment_queue_lambda[0].arn
  package_type  = "Image"
  image_uri     = var.deployment_queue_lambda_image_uri
  timeout       = var.deployment_queue_lambda_timeout_seconds
  memory_size   = var.deployment_queue_lambda_memory_size

  environment {
    variables = {
      SUPABASE_URL                          = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY             = var.supabase_service_role_key
      DATABASE_URL                          = var.database_url
      DB_POOL_MAX                           = tostring(var.deployment_queue_lambda_db_pool_max)
      DEPLOYMENT_WORKER_TASK_DEFINITION_ARN = aws_ecs_task_definition.deployment_worker[0].arn
      DEPLOYMENT_WORKER_CONTAINER_NAME      = var.deployment_worker_container_name
      DEPLOYMENT_WORKER_CLUSTER_NAME        = local.deployment_worker_cluster_name
      DEPLOYMENT_WORKER_SUBNET_IDS          = join(",", local.deployment_worker_subnet_ids)
      DEPLOYMENT_WORKER_SECURITY_GROUP_IDS  = join(",", local.deployment_worker_security_group_ids)
      DEPLOYMENT_WORKER_ASSIGN_PUBLIC_IP    = local.deployment_worker_assign_public_ip
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.deployment_queue_lambda,
    aws_iam_role_policy_attachment.deployment_queue_lambda_basic,
    aws_iam_role_policy_attachment.deployment_queue_lambda_sqs,
    aws_iam_role_policy.deployment_queue_lambda_ecs,
  ]

  tags = {
    Name        = local.deployment_queue_lambda_function_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

resource "aws_lambda_event_source_mapping" "deployment_queue" {
  count = var.enable_deployment_queue ? 1 : 0

  event_source_arn        = aws_sqs_queue.deployment_runs[0].arn
  function_name           = aws_lambda_function.deployment_queue[0].function_name
  enabled                 = true
  batch_size              = 1
  function_response_types = ["ReportBatchItemFailures"]
}
