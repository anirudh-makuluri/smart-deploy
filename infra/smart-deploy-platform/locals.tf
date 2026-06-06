data "aws_caller_identity" "current" {}

data "aws_vpc" "selected" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

data "aws_vpc" "by_id" {
  count = var.vpc_id != "" ? 1 : 0
  id    = var.vpc_id
}

locals {
  vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.selected[0].id

  name_prefix = "${var.project_name}-${var.environment}"

  s3_bucket_id = var.create_s3_bucket ? aws_s3_bucket.static[0].id : data.aws_s3_bucket.existing[0].id
  s3_bucket_arn = var.create_s3_bucket ? aws_s3_bucket.static[0].arn : data.aws_s3_bucket.existing[0].arn

  ecs_cluster_name = var.create_ecs_cluster ? aws_ecs_cluster.this[0].name : var.ecs_cluster_name
  ecs_cluster_arn  = var.create_ecs_cluster ? aws_ecs_cluster.this[0].arn : data.aws_ecs_cluster.existing[0].arn
}

data "aws_subnets" "vpc" {
  filter {
    name   = "vpc-id"
    values = [local.vpc_id]
  }
}

data "aws_subnet" "vpc_subnet" {
  for_each = toset(data.aws_subnets.vpc.ids)
  id       = each.value
}

locals {
  auto_public_subnet_ids = sort([
    for id, subnet in data.aws_subnet.vpc_subnet : id
    if subnet.map_public_ip_on_launch
  ])

  ecs_subnet_ids = length(var.ecs_subnet_ids) > 0 ? var.ecs_subnet_ids : local.auto_public_subnet_ids
}
