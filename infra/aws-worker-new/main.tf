data "aws_vpc" "default" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

locals {
  selected_vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default[0].id
}

data "aws_subnets" "selected" {
  filter {
    name   = "vpc-id"
    values = [local.selected_vpc_id]
  }
}

locals {
  selected_subnet_id = var.public_subnet_id != "" ? var.public_subnet_id : tolist(data.aws_subnets.selected.ids)[0]

  resource_name = "${var.project_name}-${var.environment}-worker"
  worker_domain = var.domain_name != "" ? "${var.worker_subdomain}.${var.domain_name}" : ""
}

data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

resource "aws_security_group" "worker" {
  name        = "${local.resource_name}-sg"
  description = "Security group for Smart Deploy worker"
  vpc_id      = local.selected_vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${local.resource_name}-sg"
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role" "worker" {
  name = "${local.resource_name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecr_readonly" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "worker" {
  name = "${local.resource_name}-instance-profile"
  role = aws_iam_role.worker.name
}

resource "aws_instance" "worker" {
  ami           = data.aws_ami.amazon_linux_2023.id
  instance_type = var.instance_type
  subnet_id     = local.selected_subnet_id

  vpc_security_group_ids = [aws_security_group.worker.id]
  iam_instance_profile   = aws_iam_instance_profile.worker.name

  key_name = var.key_name != "" ? var.key_name : null

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    worker_port        = var.worker_port
    worker_image       = var.worker_image
    aws_region         = var.aws_region
    ws_allowed_origins = join(",", var.allowed_origins)
  })

  tags = {
    Name        = local.resource_name
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_eip" "worker" {
  count    = var.assign_eip ? 1 : 0
  domain   = "vpc"
  instance = aws_instance.worker.id

  tags = {
    Name        = "${local.resource_name}-eip"
    Project     = var.project_name
    Environment = var.environment
  }
}

data "aws_route53_zone" "selected" {
  count        = var.domain_name != "" ? 1 : 0
  name         = var.domain_name
  private_zone = false
}

resource "aws_route53_record" "worker" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = data.aws_route53_zone.selected[0].zone_id
  name    = local.worker_domain
  type    = "A"
  ttl     = 300

  records = [
    var.assign_eip ? aws_eip.worker[0].public_ip : aws_instance.worker.public_ip
  ]
}
