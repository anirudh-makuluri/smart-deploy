# Fargate task security group. Smart Deploy adds ingress from the shared ALB SG at deploy time.
resource "aws_security_group" "fargate" {
  name        = "${local.name_prefix}-fargate-sg"
  description = "Smart Deploy ECS Fargate tasks (Railpack server deploys)"
  vpc_id      = local.vpc_id

  egress {
    description = "All outbound (ECR, logs, internet)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.name_prefix}-fargate-sg"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}
