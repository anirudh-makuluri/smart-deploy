resource "aws_s3_bucket" "static" {
  count  = var.create_s3_bucket ? 1 : 0
  bucket = var.s3_bucket_name

  tags = {
    Name        = var.s3_bucket_name
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform-smart-deploy-platform"
  }
}

data "aws_s3_bucket" "existing" {
  count  = var.create_s3_bucket ? 0 : 1
  bucket = var.s3_bucket_name
}

resource "aws_s3_bucket_public_access_block" "static" {
  bucket = local.s3_bucket_id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "static" {
  bucket = local.s3_bucket_id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "static" {
  bucket = local.s3_bucket_id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "static" {
  name                              = "${local.name_prefix}-static-oac"
  description                       = "OAC for Smart Deploy static site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "static" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Smart Deploy static sites (${var.project_name})"
  default_root_object = "index.html"
  price_class         = var.cloudfront_price_class

  origin {
    domain_name = var.create_s3_bucket ? aws_s3_bucket.static[0].bucket_regional_domain_name : data.aws_s3_bucket.existing[0].bucket_regional_domain_name
    origin_id   = "s3-static"
    origin_access_control_id = aws_cloudfront_origin_access_control.static.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-static"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  dynamic "custom_error_response" {
    for_each = var.cloudfront_spa_fallback ? [1] : []
    content {
      error_code         = 403
      response_code      = 200
      response_page_path = "/index.html"
    }
  }

  dynamic "custom_error_response" {
    for_each = var.cloudfront_spa_fallback ? [1] : []
    content {
      error_code         = 404
      response_code      = 200
      response_page_path = "/index.html"
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name        = "${local.name_prefix}-static-cdn"
    Project     = var.project_name
    Environment = var.environment
  }

  depends_on = [aws_s3_bucket_public_access_block.static]
}

data "aws_iam_policy_document" "static_bucket_cloudfront" {
  statement {
    sid    = "AllowCloudFrontServicePrincipal"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${local.s3_bucket_arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.static.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "static" {
  bucket = local.s3_bucket_id
  policy = data.aws_iam_policy_document.static_bucket_cloudfront.json

  depends_on = [aws_s3_bucket_public_access_block.static]
}
