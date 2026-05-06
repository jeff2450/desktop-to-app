terraform {
  required_version = ">= 1.8"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
  backend "s3" {
    bucket = "webtoapp-terraform-state"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
    encrypt = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Variables ─────────────────────────────────────────────────────────────────

variable "aws_region"    { default = "us-east-1" }
variable "db_password"   { sensitive = true }
variable "jwt_secret"    { sensitive = true }
variable "app_url"       { default = "https://webtoapp.dev" }

locals {
  name = "webtoapp"
  tags = { Project = "webtoapp", ManagedBy = "terraform" }
}

# ── VPC ───────────────────────────────────────────────────────────────────────

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = merge(local.tags, { Name = "${local.name}-vpc" })
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.tags, { Name = "${local.name}-public-${count.index}" })
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = merge(local.tags, { Name = "${local.name}-private-${count.index}" })
}

data "aws_availability_zones" "available" { state = "available" }

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "${local.name}-igw" })
}

# ── ECR ───────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "api" {
  name                 = "${local.name}-api"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  tags = local.tags
}

# ── S3 ────────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "installers" {
  bucket = "${local.name}-installers"
  tags   = local.tags
}

resource "aws_s3_bucket_versioning" "installers" {
  bucket = aws_s3_bucket.installers.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "installers" {
  bucket = aws_s3_bucket.installers.id
  rule {
    id     = "expire-old-installers"
    status = "Enabled"
    expiration { days = 90 }
    filter { prefix = "installers/" }
  }
}

resource "aws_s3_bucket_cors_configuration" "installers" {
  bucket = aws_s3_bucket.installers.id
  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "POST"]
    allowed_origins = [var.app_url]
    max_age_seconds = 3600
  }
}

# ── RDS (PostgreSQL) ──────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnet"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_security_group" "rds" {
  name   = "${local.name}-rds-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  tags = local.tags
}

resource "aws_db_instance" "main" {
  identifier             = "${local.name}-postgres"
  engine                 = "postgres"
  engine_version         = "16.3"
  instance_class         = "db.t3.small"
  allocated_storage      = 20
  max_allocated_storage  = 100
  storage_encrypted      = true
  db_name                = "webtoapp"
  username               = "webtoapp"
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  backup_retention_period = 7
  skip_final_snapshot    = false
  final_snapshot_identifier = "${local.name}-final-snapshot"
  deletion_protection    = true
  tags                   = local.tags
}

# ── ElastiCache (Redis) ───────────────────────────────────────────────────────

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${local.name}-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
  tags                 = local.tags
}

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis-subnet"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  tags = local.tags
}

# ── ECS Cluster ───────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-prod"
  setting { name = "containerInsights"; value = "enabled" }
  tags = local.tags
}

resource "aws_security_group" "ecs" {
  name   = "${local.name}-ecs-sg"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "api"
    image = "${aws_ecr_repository.api.repository_url}:latest"
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV",       value = "production" },
      { name = "PORT",           value = "3000" },
      { name = "APP_URL",        value = var.app_url },
      { name = "AWS_REGION",     value = var.aws_region },
      { name = "S3_BUCKET",      value = aws_s3_bucket.installers.bucket },
      { name = "RUN_WORKER",     value = "true" },
      { name = "USE_DOCKER",     value = "false" },
    ]
    secrets = [
      { name = "DATABASE_URL",  valueFrom = aws_ssm_parameter.db_url.arn },
      { name = "REDIS_URL",     valueFrom = aws_ssm_parameter.redis_url.arn },
      { name = "JWT_SECRET",    valueFrom = aws_ssm_parameter.jwt_secret.arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/${local.name}-api"
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
    healthCheck = {
      command     = ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 15
    }
  }])
  tags = local.tags
}

resource "aws_ecs_service" "api" {
  name            = "${local.name}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  tags = local.tags
}

# ── SSM Parameters ────────────────────────────────────────────────────────────

resource "aws_ssm_parameter" "db_url" {
  name  = "/${local.name}/prod/DATABASE_URL"
  type  = "SecureString"
  value = "postgresql://webtoapp:${var.db_password}@${aws_db_instance.main.endpoint}/webtoapp"
  tags  = local.tags
}

resource "aws_ssm_parameter" "redis_url" {
  name  = "/${local.name}/prod/REDIS_URL"
  type  = "SecureString"
  value = "redis://${aws_elasticache_cluster.redis.cache_nodes[0].address}:6379"
  tags  = local.tags
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/${local.name}/prod/JWT_SECRET"
  type  = "SecureString"
  value = var.jwt_secret
  tags  = local.tags
}

# ── IAM ───────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "ecs_execution" {
  name = "${local.name}-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  ]
  tags = local.tags
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name}-ecs-task"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
  inline_policy {
    name = "s3-access"
    policy = jsonencode({
      Version = "2012-10-17"
      Statement = [
        { Effect = "Allow", Action = ["s3:GetObject","s3:PutObject","s3:DeleteObject"], Resource = "${aws_s3_bucket.installers.arn}/*" },
        { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.installers.arn },
        { Effect = "Allow", Action = ["ssm:GetParameters","ssm:GetParameter"], Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/${local.name}/*" },
      ]
    })
  }
  tags = local.tags
}

# ── CloudWatch Logs ───────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}-api"
  retention_in_days = 30
  tags              = local.tags
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "ecr_url"         { value = aws_ecr_repository.api.repository_url }
output "s3_bucket"       { value = aws_s3_bucket.installers.bucket }
output "db_endpoint"     { value = aws_db_instance.main.endpoint; sensitive = true }
output "redis_endpoint"  { value = aws_elasticache_cluster.redis.cache_nodes[0].address; sensitive = true }
output "ecs_cluster"     { value = aws_ecs_cluster.main.name }
