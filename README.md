# sto-info-backend

## Project Overview

The `sto-info-backend` is a backend service designed to provide information related to STO (Star Trek Online) player's accounts, characters and fleets. It is built using modern web technologies and follows best practices for API development.

## Features

- RESTful API endpoints
- Authentication and authorisation
- Data validation and error handling
- Integration with external services
- _Coming soon:_ Comprehensive logging and monitoring

## Getting Started

### Prerequisites

- Node.js (version 22.x or higher)
- npm (version 10.x or higher)
- PostgreSQL database (version 14.x or higher)
- Amazon Secrets Manager

### Installation

1. Clone the repository:

```sh
git clone https://github.com/steverobertsuk/sto-info-backend.git
```

2. Navigate to the project directory:

```sh
cd sto-info-backend
```

3. Install the dependencies:

```sh
npm install
```

### Configuration

Create a `.env` file in the `config/environments/` directory by copying the `config/environments/template.env` file. Amend the values to match your local setup.
The dataseed values will automatically populate

You need to create a secret in AWS Secrets Manager with the following JSON:

```json
{
  "jwtSecret": "YourJwtSecret",
  "dbPassword": "YourDbPassword",
  "sendGridApiKey": "YourSendGridApiKey"
}
```

### Running the Application

Start the development server:

```sh
npm run start
```

The server will be running at `http://localhost:3000`.

### Running Tests

To run the tests for this project, use the following command:

```sh
npm test
```

This will execute all the unit tests and provide a summary of the test results.

### Deployment

To deploy the application, follow these steps:

1. Build the project:

```sh
npm run build
```

2. Deploy the build artifacts to your preferred hosting service.

## API Documentation

The API documentation is available at `http://localhost:3000/swagger` once the server is running. This documentation is generated using Swagger, which provides a user-friendly interface to explore and test the API endpoints. Swagger will not be loaded if in Production.

## Contributing

We welcome contributions! Please read our [contributing guidelines](CONTRIBUTING.md) for more details.

## Code Quality

We use SonarQube Cloud to ensure the code quality of this project. SonarQube helps us to identify bugs, vulnerabilities, and code smells in our codebase.

[![SonarQube Cloud](https://sonarcloud.io/images/project_badges/sonarcloud-light.svg)](https://sonarcloud.io/summary/new_code?id=steverobertsuk_sto-info-backend)

### Running SonarQube Analysis

The SonarQube analysis gets run automatically. To access the SonarQube portal for this project, please contact us at [support@startrekonline.info](mailto:support@startrekonline.info) to request being added as a user.

You can learn more about SonarQube from their [official website](https://www.sonarsource.com/products/sonarcloud/).

### Configure SonarQube Analysis in Visual Studio Code

Install the [SonarQube IDE](https://www.sonarsource.com/products/sonarlint/) and configure your `.vscode/settings.json` file to include this configuration:

```json
{
  "sonarCloudOrganization": "steverobertsuk",
  "projectKey": "steverobertsuk_sto-info-backend"
}
```

The analysis results will be available on the SonarQube dashboard.

### Current SonarQube Analysis

[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=steverobertsuk_sto-info-backend&metric=alert_status&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=steverobertsuk_sto-info-backend) [![Bugs](https://sonarcloud.io/api/project_badges/measure?project=steverobertsuk_sto-info-backend&metric=bugs&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=steverobertsuk_sto-info-backend) [![Code Smells](https://sonarcloud.io/api/project_badges/measure?project=steverobertsuk_sto-info-backend&metric=code_smells&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=steverobertsuk_sto-info-backend) [![Duplicated Lines (%)](https://sonarcloud.io/api/project_badges/measure?project=steverobertsuk_sto-info-backend&metric=duplicated_lines_density&token=112872819709705c46aa22a30dbc9cb78546a38e)](https://sonarcloud.io/summary/new_code?id=steverobertsuk_sto-info-backend)

## Licence

This project is licensed under the MIT Licence. See the [LICENCE](LICENCE) file for more information.

## Contact

For any enquiries, please contact us at [support@startrekonline.info](mailto:support@startrekonline.info).
