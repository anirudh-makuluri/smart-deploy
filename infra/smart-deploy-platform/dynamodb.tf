resource "aws_dynamodb_table" "runtime" {
  name         = var.runtime_dynamodb_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled = true
  }

  tags = {
    Name        = var.runtime_dynamodb_table_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}
